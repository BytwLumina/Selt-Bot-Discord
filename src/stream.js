import { execFile } from 'node:child_process';
import { isVoiceChannel } from './voiceSession.js';
import { isShuttingDown } from './shutdown.js';
import { ensureFfmpegOnPath } from './ffmpeg.js';
import { withTimeout } from './utils.js';

const PRESETS = new Set([
  'ultrafast', 'superfast', 'veryfast', 'faster',
  'fast', 'medium', 'slow', 'slower', 'veryslow',
]);

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function even(n) {
  return n % 2 === 0 ? n : n - 1;
}

function sanitizePreset(value) {
  const p = String(value || '').trim();
  return PRESETS.has(p) ? p : 'faster';
}

/**
 * Liệt kê camera đang gắn trên Windows.
 *
 * ffmpeg in ra danh sách thiết bị dshow rồi báo lỗi (vì không có input nào
 * được chỉ định) — nên ta đọc stderr, không cần exit code sạch.
 */
function listWindowsCameras(ffmpegBin) {
  return new Promise((resolve) => {
    if (!ffmpegBin) return resolve([]);
    try {
      execFile(
        ffmpegBin,
        ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
        { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          const text = `${stdout || ''}\n${stderr || ''}`;
          const names = [...text.matchAll(/"([^"]+)"\s*\(video\)/g)].map((m) => m[1]);
          resolve([...new Set(names)]);
        },
      );
    } catch {
      resolve([]);
    }
  });
}

async function buildCapture(cfg, { width, height, fps, ffmpegBin }) {
  const cursor = cfg.captureCursor !== false;
  const raw = String(cfg.captureSource || '').trim();
  const mode = raw.toLowerCase();
  const src = mode === 'screen' ? '' : raw;

  if (mode === 'black') {
    return {
      input: `color=black:s=${width}x${height}:r=${fps}`,
      args: ['-hide_banner', '-loglevel', 'warning', '-f', 'lavfi'],
      label: `black ${width}x${height}@${fps}`,
    };
  }

  // Camera máy — panel không xem được video nên bên ngoài vẫn hiện hình đen.
  if (mode === 'camera') {
    const wanted = String(cfg.cameraDevice || '').trim();

    if (process.platform === 'win32') {
      const cams = await listWindowsCameras(ffmpegBin);
      const pick = wanted && cams.some((c) => c.toLowerCase() === wanted.toLowerCase())
        ? wanted
        : (cams[0] || '');
      if (!pick) {
        throw new Error('Không tìm thấy camera trên máy — cài ffmpeg có dshow hoặc đổi nguồn sang "màn hình"');
      }
      return {
        input: `video=${pick}`,
        args: ['-hide_banner', '-loglevel', 'warning', '-f', 'dshow'],
        label: `camera ${pick}`,
      };
    }

    if (process.platform === 'darwin') {
      const idx = wanted || '0';
      return {
        input: idx,
        args: ['-hide_banner', '-loglevel', 'warning', '-f', 'avfoundation', '-framerate', String(fps), '-capture_cursor', '0', '-capture_mouse_clicks', '0'],
        label: `camera ${idx}`,
      };
    }

    const dev = wanted || '/dev/video0';
    return {
      input: dev,
      args: ['-hide_banner', '-loglevel', 'warning', '-f', 'v4l2', '-framerate', String(fps)],
      label: `camera ${dev}`,
    };
  }

  if (process.platform === 'win32') {
    return {
      input: src || 'desktop',
      args: ['-hide_banner', '-loglevel', 'warning', '-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', cursor ? '1' : '0'],
      label: src || 'desktop',
    };
  }

  if (process.platform === 'darwin') {
    return {
      input: src || '1:none',
      args: ['-hide_banner', '-loglevel', 'warning', '-f', 'avfoundation', '-framerate', String(fps), '-capture_cursor', cursor ? '1' : '0', '-capture_mouse_clicks', '0'],
      label: src || '1:none',
    };
  }

  return {
    input: src || process.env.DISPLAY || ':0.0',
    args: ['-hide_banner', '-loglevel', 'warning', '-f', 'x11grab', '-thread_queue_size', '512', '-framerate', String(fps), '-draw_mouse', cursor ? '1' : '0'],
    label: src || process.env.DISPLAY || ':0.0',
  };
}

function buildVideoFilter(width, height) {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    'format=yuv420p',
  ].join(',');
}

function joinHint(message) {
  const hint = /timeout|closed|4014|4006|4015|dave/i.test(message)
    ? ' — Discord có thể đã chặn vì DAVE/E2EE (lib native chưa hỗ trợ stream)'
    : '';
  return `Stream join fail: ${message}${hint}`;
}

export function createStream({ voice, confirm, watch }) {
  // Watchdog: khi stream đứt bất thường (ffmpeg lỗi, mất frame, rớt kết nối)
  // thì tự dựng lại — không áp dụng khi người dùng bấm dừng.
  let autoTimer = null;
  let autoAttempts = 0;
  let autoLastReason = '';
  let autoNextAt = 0;

  const state = {
    active: false,
    starting: false,
    stopping: false,
    guildId: null,
    channelId: null,
    guildName: '',
    channelName: '',
    startedAt: 0,
    connection: null,
    streamConnection: null,
    dispatcher: null,
    previousVoice: null,
    viewerCount: 0,
    paused: false,
    region: '',
    sawFrame: false,
    lastLog: '',
    startFrameTimer: null,
  };

  function resolveTarget({ client, channelId }) {
    if (channelId) {
      for (const guild of client.guilds?.cache?.values?.() || []) {
        const channel = guild.channels?.cache?.get?.(channelId);
        if (channel) return { guild, channel };
      }
      return null;
    }

    const vs = voice.getVoiceState();
    if (!vs.connected) return null;

    const guild = client.guilds?.cache?.get(vs.guildId);
    const channel = guild?.channels?.cache?.get(vs.channelId);
    if (!guild || !channel) return null;
    return { guild, channel };
  }

  function clearStartTimer() {
    if (state.startFrameTimer) {
      clearTimeout(state.startFrameTimer);
      state.startFrameTimer = null;
    }
  }

  function resetRuntime() {
    clearStartTimer();
    state.active = false;
    state.starting = false;
    state.guildId = null;
    state.channelId = null;
    state.guildName = '';
    state.channelName = '';
    state.startedAt = 0;
    state.connection = null;
    state.streamConnection = null;
    state.dispatcher = null;
    state.previousVoice = null;
    state.viewerCount = 0;
    state.paused = false;
    state.region = '';
    state.sawFrame = false;
    state.lastLog = '';
  }

  function bindNative(conn, ctx) {
    const { logger, stats } = ctx;

    conn.on('error', (e) => {
      const msg = e?.message || String(e);
      state.lastLog = msg.slice(0, 300);
      logger?.error(`Stream voice error: ${msg}`);
      stats?.bump?.('errors');
      if (state.active && !state.stopping) {
        void stopStream({ ...ctx, reason: `voice error: ${msg}`, unexpected: true });
      }
    });

    conn.on('warn', (e) => {
      logger?.debug(`Stream voice warn: ${e?.message || e}`);
    });

    conn.on('disconnect', () => {
      if (state.active && !state.stopping) {
        void stopStream({ ...ctx, reason: 'voice disconnect', unexpected: true });
      }
    });

    conn.on('debug', (msg) => {
      const s = String(msg || '');
      const marker = '[ffmpeg-video_process]';
      if (!s.includes(marker)) return;
      const line = s.slice(s.indexOf(marker) + marker.length).trim();
      if (!line) return;
      state.lastLog = line.slice(0, 300);
      logger?.debug(`ffmpeg: ${state.lastLog}`);
    });
  }

  function bindStream(streamConn, ctx) {
    const { logger, stats } = ctx;

    streamConn.on('error', (e) => {
      const msg = e?.message || String(e);
      state.lastLog = msg.slice(0, 300);
      logger?.error(`Stream error: ${msg}`);
      stats?.bump?.('errors');
      if (state.active && !state.stopping) {
        void stopStream({ ...ctx, reason: `stream error: ${msg}`, unexpected: true });
      }
    });

    streamConn.on('warn', (e) => {
      logger?.debug(`Stream warn: ${e?.message || e}`);
    });

    streamConn.on('disconnect', () => {
      if (state.active && !state.stopping) {
        void stopStream({ ...ctx, reason: 'stream disconnect', unexpected: true });
      }
    });

    streamConn.on('streamUpdate', (oldData, newData) => {
      state.viewerCount = newData?.viewerIds?.length ?? 0;
      state.paused = !!newData?.isPaused;
      if (newData?.region) state.region = String(newData.region);
    });
  }

  function bindDispatcher(dispatcher, ctx) {
    const { logger } = ctx;

    dispatcher.on('start', () => {
      state.sawFrame = true;
      clearStartTimer();
      logger?.voice('Stream đã gửi frame đầu tiên');
    });

    dispatcher.on('error', (e) => {
      const msg = e?.message || String(e);
      state.lastLog = msg.slice(0, 300);
      logger?.error(`Stream ffmpeg: ${msg}`);
      if (state.active && !state.stopping) {
        void stopStream({ ...ctx, reason: `ffmpeg: ${msg}`, unexpected: true });
      }
    });

    // Video dispatcher báo lỗi ffmpeg qua 'debug' (không phải 'error')
    dispatcher.on('debug', (m) => {
      const s = String(m?.message || m || '');
      if (!s) return;
      if (/ffmpeg stream:|input stream:|Failed to send a packet/i.test(s)) {
        state.lastLog = s.slice(0, 300);
        logger?.error(`Stream ffmpeg: ${s}`);
        if (state.active && !state.stopping) {
          void stopStream({ ...ctx, reason: s, unexpected: true });
        }
      }
    });

    dispatcher.on('finish', () => {
      if (state.active && !state.stopping) {
        void stopStream({ ...ctx, reason: 'ffmpeg kết thúc', unexpected: true });
      }
    });
  }

  function clearAutoRestart() {
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
    autoNextAt = 0;
  }

  function autoRestartInfo() {
    return {
      enabled: state.autoRestartEnabled !== false,
      pending: !!autoTimer,
      attempts: autoAttempts,
      nextInMs: autoNextAt ? Math.max(0, autoNextAt - Date.now()) : 0,
      lastReason: autoLastReason,
    };
  }

  function scheduleAutoRestart(restart) {
    if (isShuttingDown()) return false;
    if (!restart || !restart.client) return false;

    const cfg = restart.config?.stream || {};
    if (cfg.autoRestart === false) return false;

    const max = Math.min(20, Math.max(0, Number.parseInt(cfg.autoRestartMax, 10) || 0));
    if (autoAttempts >= max) {
      autoLastReason = restart.reason || '';
      restart.logger?.warn(`Stream không tự dựng lại nữa — đã thử ${autoAttempts} lần (${restart.reason})`);
      return false;
    }

    clearAutoRestart();
    const delay = Math.min(600000, Math.max(3000, Number.parseInt(cfg.autoRestartDelayMs, 10) || 10000));
    autoAttempts += 1;
    autoLastReason = restart.reason || '';
    autoNextAt = Date.now() + delay;

    restart.logger?.warn(
      `Stream đứt (${restart.reason}) — tự dựng lại lần ${autoAttempts}/${max} sau ${Math.round(delay / 1000)}s`,
    );

    autoTimer = setTimeout(() => {
      autoTimer = null;
      autoNextAt = 0;
      if (isShuttingDown()) return;
      startStream({
        client: restart.client,
        channelId: restart.channelId,
        config: restart.config,
        logger: restart.logger,
        stats: restart.stats,
        auto: true,
      }).catch((e) => {
        // Vẫn còn lượt thì hẹn tiếp, hết lượt thì thôi
        scheduleAutoRestart({
          ...restart,
          reason: e?.message || 'khởi động lại lỗi',
        });
      });
    }, delay);
    if (autoTimer.unref) autoTimer.unref();
    return true;
  }

  function getStreamState() {
    return {
      active: state.active,
      starting: state.starting,
      stopping: state.stopping,
      guildId: state.guildId,
      channelId: state.channelId,
      guildName: state.guildName,
      channelName: state.channelName,
      startedAt: state.startedAt,
      viewerCount: state.viewerCount,
      paused: state.paused,
      region: state.region,
      lastError: state.lastLog,
      autoRestart: autoRestartInfo(),
    };
  }

  function isStreaming() {
    return state.active || state.starting;
  }

  function setStreamPaused(paused, { logger } = {}) {
    if (!state.active) throw new Error('Chưa stream');

    const value = !!paused;
    if (value) {
      state.streamConnection?.sendScreenshareState?.(true);
      state.dispatcher?.pause?.();
    } else {
      state.dispatcher?.resume?.();
      state.streamConnection?.sendScreenshareState?.(false);
    }

    state.paused = value;
    logger?.voice(value ? 'Stream đã pause' : 'Stream đã resume');
    return state.paused;
  }

  async function getStreamPreview({ client } = {}) {
    if (!state.active) throw new Error('Chưa stream');

    const streamKey = state.streamConnection?.streamKey;
    if (!streamKey) throw new Error('Không lấy được stream key');

    const data = await client.api.streams[encodeURIComponent(streamKey)].preview.get();
    return String(data?.url || '');
  }

  async function startStream({ client, channelId, config, logger, stats, auto = false }) {
    if (isShuttingDown()) throw new Error('Đang dừng selfbot');
    if (state.active) throw new Error('Đang stream — dùng .stream stop trước');
    if (state.starting) throw new Error('Đang khởi động stream — chờ chút');
    if (state.stopping) throw new Error('Đang dừng stream — chờ chút');

    const cfg = config?.stream || {};
    // Người dùng chủ động bật → xoá hẹn tự dựng lại đang chờ và đếm lại từ đầu
    if (!auto) {
      clearAutoRestart();
      autoAttempts = 0;
      autoLastReason = '';
    }
    state.autoRestartEnabled = cfg.autoRestart !== false;
    if (cfg.enabled === false) throw new Error('Stream đang tắt trong config (stream.enabled = false)');
    if (watch.isWatching()) throw new Error('Đang xem stream người khác — dùng .stream unwatch trước');

    const target = resolveTarget({ client, channelId });
    if (!target) {
      if (channelId) throw new Error(`Không tìm thấy channel "${channelId}"`);
      throw new Error('Chưa ở voice channel nào — dùng .stream <channel_id>');
    }
    if (!isVoiceChannel(target.channel)) {
      throw new Error(`"${target.channel.name}" không phải voice channel`);
    }
    if (target.channel.joinable === false) {
      throw new Error(`Không thể join "${target.channel.name}" (thiếu quyền?)`);
    }

    const vs = voice.getVoiceState();
    if (vs.connecting) throw new Error('Đang kết nối voice — thử lại sau');

    state.starting = true;

    const ffmpegBin = await ensureFfmpegOnPath(logger);
    if (!state.starting || isShuttingDown()) {
      state.starting = false;
      throw new Error('Đã huỷ stream');
    }
    if (!ffmpegBin) {
      state.starting = false;
      throw new Error('Không tìm thấy ffmpeg có libx264 — chạy npm install (ffmpeg-static) hoặc cài ffmpeg vào PATH');
    }

    try { confirm.cancel(); } catch {}

    const ctx = { client, config, logger, stats };

    state.previousVoice = vs.connected ? { guildId: vs.guildId, channelId: vs.channelId } : null;
    state.guildId = target.guild.id;
    state.channelId = target.channel.id;
    state.guildName = target.guild.name || '';
    state.channelName = target.channel.name || '';
    state.viewerCount = 0;
    state.sawFrame = false;
    state.lastLog = '';

    try {
      // Native stack và @discordjs/voice không được cùng chiếm voice session
      if (state.previousVoice) await voice.leaveVoice({ logger, stats });
      if (isShuttingDown() || state.stopping) throw new Error('Đã huỷ stream');

      try { client.voice.connection?.disconnect(); } catch {}

      const conn = await client.voice.joinChannel(target.channel, {
        selfMute: config?.voice?.selfMute ?? false,
        selfDeaf: config?.voice?.selfDeaf ?? true,
        selfVideo: false,
        videoCodec: 'H264',
      });
      state.connection = conn;
      bindNative(conn, ctx);
      if (isShuttingDown() || state.stopping) {
        try { conn.disconnect(); } catch {}
        throw new Error('Đã huỷ stream');
      }

      const streamConn = await withTimeout(
        conn.createStreamConnection(),
        20000,
        'Stream connection timeout',
      );
      state.streamConnection = streamConn;
      bindStream(streamConn, ctx);
      if (isShuttingDown() || state.stopping) {
        try { streamConn.disconnect(); } catch {}
        throw new Error('Đã huỷ stream');
      }

      const width = even(clampInt(cfg.width, 320, 2560, 640));
      const height = even(clampInt(cfg.height, 240, 1440, 360));
      const fps = clampInt(cfg.fps, 1, 60, 15);
      const bitrate = clampInt(cfg.bitrateKbps, 500, 8000, 1200);

      const cap = await buildCapture(cfg, { width, height, fps, ffmpegBin });

      logger?.voice(`Capture ${cap.label} → ${width}x${height}@${fps} · ${bitrate} kbps`);

      const dispatcher = streamConn.playVideo(cap.input, {
        fps,
        bitrate,
        presetH26x: sanitizePreset(cfg.preset),
        inputFFmpegArgs: cap.args,
        outputFFmpegArgs: [
          '-vf', buildVideoFilter(width, height),
          '-pix_fmt', 'yuv420p',
          '-g', String(fps * 2),
        ],
      });
      state.dispatcher = dispatcher;
      bindDispatcher(dispatcher, ctx);

      state.active = true;
      state.startedAt = Date.now();
      stats?.bump?.('streamStarts');
      logger?.ok(`Stream live: ${state.guildName}/${state.channelName}`);

      state.startFrameTimer = setTimeout(() => {
        if (!state.active || state.stopping || state.sawFrame) return;
        void stopStream({ ...ctx, reason: 'không nhận được frame sau 15s', unexpected: true });
      }, 15000);
      if (state.startFrameTimer.unref) state.startFrameTimer.unref();

      return { guildName: state.guildName, channelName: state.channelName };
    } catch (e) {
      const msg = e?.message || String(e);
      try {
        await stopStream({ ...ctx, restore: true, reason: `start fail: ${msg}` });
      } catch {}
      throw new Error(joinHint(msg));
    } finally {
      state.starting = false;
    }
  }

  async function stopStream({
    client,
    config,
    logger,
    stats,
    restore = true,
    reason = '',
    unexpected = false,
  } = {}) {
    if (state.stopping) return false;
    if (!state.active && !state.starting && !state.connection && !state.streamConnection) return false;

    state.stopping = true;

    const snap = {
      active: state.active,
      connection: state.connection,
      streamConnection: state.streamConnection,
      dispatcher: state.dispatcher,
      previousVoice: state.previousVoice,
      channelId: state.channelId,
      lastLog: state.lastLog,
    };

    resetRuntime();

    try { snap.dispatcher?.destroy(); } catch {}
    try { snap.streamConnection?.disconnect(); } catch {}
    try { snap.connection?.disconnect(); } catch {}
    try {
      if (client?.voice?.connection && client.voice.connection !== snap.connection) {
        client.voice.connection.disconnect();
      }
    } catch {}

    if (snap.active) stats?.bump?.('streamStops');

    if (reason) {
      const detail = snap.lastLog ? ` (${snap.lastLog.slice(0, 160)})` : '';
      logger?.warn(`Stream dừng: ${reason}${detail}`);
    } else if (snap.active) {
      logger?.voice('Đã dừng stream');
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

    if (unexpected && snap.active) {
      scheduleAutoRestart({
        client,
        config,
        logger,
        stats,
        channelId: snap.channelId,
        reason: reason || 'stream đứt',
      });
    }

    return true;
  }

  return {
    getStreamState,
    isStreaming,
    setStreamPaused,
    getStreamPreview,
    startStream,
    stopStream,
  };
}
