import path from 'node:path';
import fs from 'node:fs';
import { isShuttingDown } from './shutdown.js';
import { ensureFfmpegOnPath } from './ffmpeg.js';
import { isVoiceChannel } from './voiceSession.js';
import { withTimeout } from './utils.js';

export function createStreamWatch({ voice, getStream }) {
  const state = {
    active: false,
    starting: false,
    stopping: false,
    guildId: null,
    channelId: null,
    guildName: '',
    channelName: '',
    userId: null,
    username: '',
    startedAt: 0,
    conn: null,
    recorder: null,
    previousVoice: null,
    file: '',
    viewers: 0,
    paused: false,
    region: '',
    sawData: false,
    lastLog: '',
  };

  function resetRuntime() {
    state.active = false;
    state.starting = false;
    state.guildId = null;
    state.channelId = null;
    state.guildName = '';
    state.channelName = '';
    state.userId = null;
    state.username = '';
    state.startedAt = 0;
    state.conn = null;
    state.recorder = null;
    state.previousVoice = null;
    state.file = '';
    state.viewers = 0;
    state.paused = false;
    state.region = '';
    state.sawData = false;
    state.lastLog = '';
  }

  function stopIfActive(reason, ctx) {
    if (state.active && !state.stopping) {
      void stopWatch({ ...ctx, reason });
    }
  }

  function bindParent(conn, ctx) {
    const { logger, stats } = ctx;

    conn.on('error', (e) => {
      const msg = e?.message || String(e);
      state.lastLog = msg.slice(0, 300);
      logger?.error(`Watch voice error: ${msg}`);
      stats?.bump?.('errors');
      stopIfActive(`voice error: ${msg}`, ctx);
    });

    conn.on('warn', (e) => {
      logger?.debug(`Watch voice warn: ${e?.message || e}`);
    });

    conn.on('disconnect', () => {
      stopIfActive('voice disconnect', ctx);
    });

    conn.on('debug', (msg) => {
      const s = String(msg || '');
      if (/Watch|STREAM/i.test(s)) {
        state.lastLog = s.slice(0, 300);
        logger?.debug(`watch: ${s.slice(0, 200)}`);
      }
    });
  }

  function bindWatch(watchConn, ctx) {
    const { logger, stats } = ctx;

    watchConn.on('error', (e) => {
      const msg = e?.message || String(e);
      state.lastLog = msg.slice(0, 300);
      logger?.error(`Watch error: ${msg}`);
      stats?.bump?.('errors');
      stopIfActive(`watch error: ${msg}`, ctx);
    });

    watchConn.on('warn', (e) => {
      logger?.debug(`Watch warn: ${e?.message || e}`);
    });

    watchConn.on('streamUpdate', (_oldData, newData) => {
      state.viewers = newData?.viewerIds?.length ?? 0;
      state.paused = !!newData?.isPaused;
      if (newData?.region) state.region = String(newData.region);
    });

    watchConn.on('disconnect', () => {
      stopIfActive('stream kết thúc', ctx);
    });
  }

  function bindRecorder(recorder, ctx) {
    const { logger } = ctx;

    recorder.on('ready', () => {
      state.sawData = true;
      logger?.debug(`Watch recorder ready → ${state.file}`);
    });

    recorder.on('debug', (m) => {
      logger?.debug(`recorder: ${String(m || '').slice(0, 200)}`);
    });

    recorder.on('closed', () => {
      stopIfActive('recorder đóng', ctx);
    });

    recorder.stream?.on?.('error', (e) => {
      const msg = e?.message || String(e);
      state.lastLog = msg.slice(0, 300);
      logger?.error(`Watch ffmpeg: ${msg}`);
    });
  }

  function getWatchState() {
    return {
      active: state.active,
      starting: state.starting,
      stopping: state.stopping,
      guildId: state.guildId,
      channelId: state.channelId,
      guildName: state.guildName,
      channelName: state.channelName,
      userId: state.userId,
      username: state.username,
      startedAt: state.startedAt,
      viewers: state.viewers,
      paused: state.paused,
      region: state.region,
      sawData: state.sawData,
      file: state.file,
      lastError: state.lastLog,
    };
  }

  function isWatching() {
    return state.active || state.starting;
  }

  function listStreamers({ client, guild } = {}) {
    let scope = guild || null;
    if (!scope) {
      const vs = voice.getVoiceState();
      if (!vs.connected) return null;
      scope = client?.guilds?.cache?.get(vs.guildId) || null;
    }
    if (!scope) return null;

    const streamers = [];
    for (const voiceState of scope.voiceStates?.cache?.values?.() || []) {
      if (!voiceState.streaming) continue;
      const channel = scope.channels?.cache?.get(voiceState.channelId);
      const user = voiceState.member?.user;
      streamers.push({
        id: voiceState.id,
        name: user ? (user.tag || user.username) : voiceState.id,
        channelId: voiceState.channelId,
        channelName: channel?.name || voiceState.channelId,
        camera: !!voiceState.selfVideo,
      });
    }

    return { guildId: scope.id, guildName: scope.name || '', streamers };
  }

  async function watchStream({ client, userId, guild, config, logger, stats }) {
    if (isShuttingDown()) throw new Error('Đang dừng selfbot');
    if (state.active) throw new Error(`Đang xem ${state.username || state.userId} — dùng .stream unwatch trước`);
    if (state.starting) throw new Error('Đang kết nối watch — chờ chút');
    if (state.stopping) throw new Error('Đang dừng watch — chờ chút');

    const streamSt = getStream().getStreamState();
    if (streamSt.active || streamSt.starting) {
      throw new Error('Đang stream — dừng stream trước khi xem stream người khác');
    }

    const id = String(userId || '').trim();
    if (!/^\d{5,25}$/.test(id)) {
      throw new Error('Cần user ID — dùng .stream who để xem ai đang stream');
    }

    const cfg = config?.stream || {};
    if (cfg.enabled === false) throw new Error('Stream đang tắt trong config (stream.enabled = false)');

    const ffmpegBin = await ensureFfmpegOnPath(logger);
    if (!ffmpegBin) {
      throw new Error('Không tìm thấy ffmpeg — chạy npm install (ffmpeg-static) hoặc cài ffmpeg vào PATH');
    }

    // Scope: sever nơi gửi lệnh; console/DM thì lấy sever của voice hiện tại
    let scopeGuild = guild || null;
    if (!scopeGuild) {
      const vs0 = voice.getVoiceState();
      if (vs0.connected) scopeGuild = client?.guilds?.cache?.get(vs0.guildId) || null;
    }
    if (!scopeGuild) {
      throw new Error('Nhắn lệnh trong sever (hoặc vào voice) để biết tìm stream ở đâu');
    }

    // Check trước khi xem: user phải đang Go Live trong đúng sever đó
    const available = listStreamers({ client, guild: scopeGuild });
    const target = (available?.streamers || []).find((s) => s.id === id);
    if (!target) {
      const list = (available?.streamers || [])
        .map((s) => `${s.id} (${s.name} @ ${s.channelName})`)
        .join(', ') || 'không có ai';
      throw new Error(`${id} không stream ở sever này. Đang stream: ${list}`);
    }
    if (id === client?.user?.id) {
      throw new Error('Đó là chính cậu — dùng .stream để tự Go Live');
    }

    const channel = scopeGuild.channels?.cache?.get(target.channelId);
    if (!channel || !isVoiceChannel(channel)) {
      throw new Error(`"${target.channelName}" không phải voice channel`);
    }
    if (channel.joinable === false) {
      throw new Error(`Không thể join "${channel.name}" (thiếu quyền?)`);
    }

    const vs = voice.getVoiceState();
    if (vs.connecting) throw new Error('Đang kết nối voice — thử lại sau');

    state.starting = true;
    const ctx = { client, config, logger, stats };

    state.previousVoice = vs.connected ? { guildId: vs.guildId, channelId: vs.channelId } : null;
    state.guildId = scopeGuild.id;
    state.channelId = channel.id;
    state.guildName = scopeGuild.name || '';
    state.channelName = channel.name || '';
    state.userId = target.id;
    state.username = target.name;
    state.viewers = 0;
    state.paused = false;
    state.region = '';
    state.sawData = false;
    state.lastLog = '';

    try {
      // Watch dùng native voice stack — tạm rời @discordjs/voice, unwatch thì vào lại
      await voice.leaveVoice({ logger, stats });
      if (isShuttingDown() || state.stopping) throw new Error('Đã huỷ watch');

      try { client.voice.connection?.disconnect(); } catch {}

      const conn = await client.voice.joinChannel(channel, {
        selfMute: true,
        selfDeaf: false,
        selfVideo: false,
        videoCodec: 'H264',
      });
      state.conn = conn;
      bindParent(conn, ctx);
      if (isShuttingDown() || state.stopping) {
        try { conn.disconnect(); } catch {}
        throw new Error('Đã huỷ watch');
      }

      const watchConn = await withTimeout(
        conn.joinStreamConnection(target.id),
        20000,
        'Watch connection timeout',
      );
      bindWatch(watchConn, ctx);
      if (isShuttingDown() || state.stopping) {
        try { watchConn.disconnect(); } catch {}
        throw new Error('Đã huỷ watch');
      }

      const recordDir = path.resolve(cfg.recordDir || 'recordings');
      fs.mkdirSync(recordDir, { recursive: true });
      const file = path.join(recordDir, `${target.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.mkv`);

      const recorder = watchConn.receiver.packets.makeVideoStream(target.id, file);
      state.recorder = recorder;
      bindRecorder(recorder, ctx);

      state.active = true;
      state.startedAt = Date.now();
      state.file = file;
      stats?.bump?.('streamWatches');
      logger?.ok(`Watch stream: ${target.name} → ${file}`);

      return { file, username: target.name, channelName: state.channelName, guildName: state.guildName };
    } catch (e) {
      const msg = e?.message || String(e);
      try {
        await stopWatch({ ...ctx, restore: true, reason: `watch fail: ${msg}` });
      } catch {}
      throw new Error(msg);
    } finally {
      state.starting = false;
    }
  }

  async function stopWatch({
    client,
    config,
    logger,
    stats,
    restore = true,
    reason = '',
  } = {}) {
    if (state.stopping) return false;
    if (!state.active && !state.starting && !state.conn && !state.recorder) return false;

    state.stopping = true;

    const snap = {
      active: state.active,
      startedAt: state.startedAt,
      conn: state.conn,
      recorder: state.recorder,
      previousVoice: state.previousVoice,
      file: state.file,
      lastLog: state.lastLog,
    };

    resetRuntime();

    try { snap.recorder?.destroy?.(); } catch {}
    try { snap.recorder?.stream?.kill?.('SIGKILL'); } catch {}
    try { snap.conn?.disconnect?.(); } catch {}
    try {
      if (client?.voice?.connection && client.voice.connection !== snap.conn) {
        client.voice.connection.disconnect();
      }
    } catch {}

    if (snap.active) {
      stats?.bump?.('streamWatchStops');
      if (reason) {
        logger?.warn(`Watch dừng: ${reason}`);
      } else {
        logger?.voice(`Đã dừng watch — ghi vào ${snap.file}`);
      }
    } else if (reason) {
      logger?.warn(`Watch dừng: ${reason}`);
    }

    if (
      restore &&
      snap.previousVoice &&
      config?.stream?.restoreVoice !== false &&
      !isShuttingDown() &&
      client?.user
    ) {
      try {
        await voice.joinVoice({
          client,
          guildId: snap.previousVoice.guildId,
          channelId: snap.previousVoice.channelId,
          config,
          logger,
          stats,
        });
        logger?.voice('Đã khôi phục voice');
      } catch (e) {
        logger?.warn(`Khôi phục voice fail: ${e.message}`);
      }
    }

    state.stopping = false;
    return true;
  }

  return { getWatchState, isWatching, listStreamers, watchStream, stopWatch };
}
