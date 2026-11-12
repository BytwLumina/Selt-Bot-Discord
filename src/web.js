import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLogger } from './logger.js';
import { isVoiceChannel } from './voiceSession.js';
import {
  getAllSnipes,
  getAllEditSnipes,
  getStats as getSnipeStats,
} from './snipe.js';
import { parseUserToken } from './tokenParse.js';
import { parseChannelRef } from './utils.js';
import { bumpRequest, requestSnapshot } from './requestMetrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.resolve(__dirname, 'web.html');
const ASSETS_DIR = path.resolve(__dirname, 'assets');
const ASSET_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

// Bản web React (Vite) build ra src/web-dist — dùng nếu có, không thì rơi về web.html
const WEB_DIST_DIR = path.resolve(__dirname, 'web-dist');
const WEB_DIST_INDEX = path.join(WEB_DIST_DIR, 'index.html');
const WEB_DIST_ASSETS = path.join(WEB_DIST_DIR, 'ui');
const UI_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const LOG_RING_MAX = 600;
const BODY_LIMIT = 10 * 1024;
const MAX_GUILDS = 100;
const MAX_CHANNELS_PER_GUILD = 100;

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const log = makeLogger('web');

let logRing = [];
let logCursor = 0;

export function pushWebLog(line) {
  logRing.push({ n: ++logCursor, line: String(line ?? '').replace(ANSI_RE, '') });
  if (logRing.length > LOG_RING_MAX) {
    logRing.splice(0, logRing.length - LOG_RING_MAX);
  }
}

const ctx = {
  getClient: () => null,
  getConfig: () => ({}),
  getStats: () => null,
  getSession: () => null,
  getAccounts: () => [],
  getFocusedId: () => null,
  focusAccount: () => false,
  getAccount: () => null,
  addAccount: async () => ({ ok: false, error: 'Không hỗ trợ thêm account' }),
  removeAccount: async () => ({ ok: false, error: 'Không hỗ trợ xoá account' }),
  retryAccount: async () => ({ ok: false, error: 'Không hỗ trợ đăng nhập lại' }),
  getHealth: () => null,
};

let server = null;
let serverPort = 0;

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function fail(res, status, message) {
  json(res, status, { ok: false, error: message });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) {
        reject(new HttpError(413, 'Body quá lớn'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => reject(new HttpError(400, 'Đọc body lỗi')));
  });
}

function readJsonBody(req) {
  return (async () => {
    const raw = await readBody(req);
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('không phải object');
      }
      return parsed;
    } catch {
      throw new HttpError(400, 'Body phải là JSON object');
    }
  })();
}

function str(v, max = 100) {
  return String(v ?? '').trim().slice(0, max);
}

function numIn(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function checkToken(value) {
  const t = String(value ?? '').trim();
  if (!t) return { ok: false, error: 'Token rỗng' };
  if (t.length < 20) return { ok: false, error: 'Token quá ngắn' };
  const parsed = parseUserToken(t);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, discordId: parsed.discordId };
}

// ── Chọn account theo request ────────────────────────────
function accountSummaries() {
  return ctx.getAccounts?.() || [];
}

function pickAcct(url, body) {
  const id = str(url.searchParams.get('acct') || body?.acct, 40);
  const list = accountSummaries();

  if (id) {
    if (!list.some((a) => a.id === id)) {
      throw new HttpError(404, `Không có account "${id}"`);
    }
    return ctx.getAccount?.(id) || null;
  }

  const focused = ctx.getFocusedId?.();
  if (focused && ctx.getAccount?.(focused)) return ctx.getAccount(focused);
  if (list.length) return ctx.getAccount?.(list[0].id) || null;
  return null;
}

function needAcct(url, body) {
  const acct = pickAcct(url, body);
  if (!acct) throw new HttpError(503, 'Chưa có account nào');
  return acct;
}

function needClient(acct) {
  const client = acct?.client;
  if (!client?.user) throw new HttpError(503, 'Selfbot chưa đăng nhập');
  return client;
}

// ── Guild resolution ─────────────────────────────────────
function resolveGuild(acct, client, guildId) {
  if (guildId) {
    const g = client.guilds?.cache?.get(str(guildId, 25));
    if (!g) throw new HttpError(404, `Không tìm thấy sever ${guildId}`);
    return g;
  }
  // Không chọn sever: dùng sever của voice hiện tại; nếu chỉ có 1 sever thì dùng nó
  const vs = acct.voice.getVoiceState();
  if (vs.connected) {
    const g = client.guilds?.cache?.get(vs.guildId);
    if (g) return g;
  }
  if (client.guilds?.cache?.size === 1) {
    return client.guilds.cache.first();
  }
  throw new HttpError(400, 'Chọn sever trước (cần guildId)');
}

function guildList(client) {
  const out = [];
  for (const g of client.guilds?.cache?.values?.() || []) {
    if (out.length >= MAX_GUILDS) break;
    const channels = [];
    for (const c of g.channels?.cache?.values?.() || []) {
      if (channels.length >= MAX_CHANNELS_PER_GUILD) break;
      if (!isVoiceChannel(c)) continue;
      if (c.joinable === false) continue;
      channels.push({ id: c.id, name: c.name });
    }
    channels.sort((a, b) => a.name.localeCompare(b.name));
    out.push({ id: g.id, name: g.name, channels });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ── API handlers ─────────────────────────────────────────
function statusSnapshot(acct) {
  const client = acct?.client || null;
  const stats = acct?.stats?.snapshot?.() || null;
  let session = null;
  try { session = ctx.getSession()?.snapshot?.() || null; } catch {}

  const vs = acct ? acct.voice.getVoiceState() : null;
  const st = acct ? acct.stream.getStreamState() : null;
  const w = acct ? acct.watch.getWatchState() : null;
  const afk = acct ? acct.afk.getAfk() : null;
  const rpc = acct ? acct.rpc.getRpcState() : null;
  const owo = acct?.owo ? acct.owo.getState() : null;
  const streamCfg = ctx.getConfig?.()?.stream || {};

  return {
    ok: true,
    now: Date.now(),
    account: acct ? { id: acct.id, name: acct.name } : null,
    accounts: accountSummaries(),
    focusedId: ctx.getFocusedId?.() || null,
    loggedIn: !!client?.user,
    user: client?.user ? { tag: client.user.tag, id: client.user.id } : null,
    ping: Math.max(0, Number(client?.ws?.ping) || 0),
    guildCount: client?.guilds?.cache?.size || 0,
    stats,
    session,
    health: ctx.getHealth?.() || null,
    voice: {
      connected: !!vs?.connected,
      connecting: !!vs?.connecting,
      guildId: vs?.guildId,
      channelId: vs?.channelId,
      status: vs?.status,
      reconnectAttempts: vs?.reconnectAttempts,
      lastError: vs?.lastError,
    },
    stream: {
      active: !!st?.active,
      starting: !!st?.starting,
      paused: !!st?.paused,
      startedAt: st?.startedAt || 0,
      viewerCount: st?.viewerCount || 0,
      region: st?.region || '',
      guildId: st?.guildId,
      guildName: st?.guildName,
      channelName: st?.channelName,
      lastError: st?.lastError,
      autoRestarting: !!st?.autoRestart?.pending,
      autoRestarts: st?.autoRestart?.attempts || 0,
      autoRestartMax: Number(streamCfg.autoRestartMax) || 0,
      config: {
        width: streamCfg.width || 0,
        height: streamCfg.height || 0,
        fps: streamCfg.fps || 0,
        bitrateKbps: streamCfg.bitrateKbps || 0,
        captureSource: String(streamCfg.captureSource || '') || 'black',
        autoRestart: streamCfg.autoRestart !== false,
        autoRestartMax: Number(streamCfg.autoRestartMax) || 0,
        autoRestartDelayMs: Number(streamCfg.autoRestartDelayMs) || 0,
      },
    },
    watch: {
      active: !!w?.active,
      starting: !!w?.starting,
      userId: w?.userId,
      username: w?.username,
      guildId: w?.guildId,
      guildName: w?.guildName,
      channelName: w?.channelName,
      startedAt: w?.startedAt || 0,
      file: w?.file,
      lastError: w?.lastError,
    },
    afk: {
      enabled: !!afk?.enabled,
      reason: afk?.reason || '',
      setAt: afk?.setAt || 0,
      duration: afk?.duration || 0,
      totalPings: afk?.totalPings || 0,
      totalReplies: afk?.totalReplies || 0,
      silentMode: !!afk?.silentMode,
      reactEmoji: afk?.reactEmoji || '',
      topPingers: afk?.topPingers || [],
    },
    rpc: {
      enabled: !!rpc?.enabled,
      applied: !!rpc?.applied,
      type: rpc?.type || '',
      name: rpc?.name || '',
      lastError: rpc?.lastError || '',
    },
    owo,
    requests: requestSnapshot(30),
  };
}

// ── Prometheus metrics ───────────────────────────────────
function buildMetrics() {
  const lines = [];
  const push = (name, help, type, samples) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    for (const s of samples) {
      const labels = s.labels ? `{${s.labels}}` : '';
      lines.push(`${name}${labels} ${s.value}`);
    }
  };

  const accounts = accountSummaries();
  const session = ctx.getSession?.()?.snapshot?.() || null;
  const health = ctx.getHealth?.() || null;
  const stats = ctx.getStats?.()?.snapshot?.() || null;

  push('lumina_uptime_seconds', 'Thời gian process đã chạy (giây)', 'gauge', [
    { value: process.uptime().toFixed(3) },
  ]);

  push('lumina_accounts', 'Số account theo trạng thái', 'gauge', [
    { labels: 'state="total"', value: accounts.length },
    { labels: 'state="ready"', value: accounts.filter((a) => a.ready).length },
    { labels: 'state="error"', value: accounts.filter((a) => !a.ready).length },
  ]);

  push('lumina_account_restarts_total', 'Số lần tự đăng nhập lại', 'counter',
    accounts.map((a) => ({ labels: `account="${a.id}"`, value: a.restarts || 0 })));

  push('lumina_account_uptime_seconds', 'Thời gian account đã chạy', 'gauge',
    accounts.map((a) => ({
      labels: `account="${a.id}"`,
      value: a.startedAt ? ((Date.now() - a.startedAt) / 1000).toFixed(3) : 0,
    })));

  const owoRows = (ctx.getAccounts?.() || [])
    .map((a) => ({ id: a?.id, o: a?.owo?.getState?.() }))
    .filter((r) => r.o);
  if (owoRows.length) {
    push('lumina_owo_running', 'OwO farm có đang chạy không', 'gauge',
      owoRows.map((r) => ({ labels: `account="${r.id}"`, value: r.o.enabled ? 1 : 0 })));
    push('lumina_owo_sent_total', 'Số lệnh OwO đã gửi', 'counter',
      owoRows.map((r) => ({ labels: `account="${r.id}"`, value: r.o.counters?.commands || 0 })));
    push('lumina_owo_catches_total', 'Số pet/item bắt được', 'counter',
      owoRows.map((r) => ({ labels: `account="${r.id}"`, value: r.o.counters?.catches || 0 })));
    push('lumina_owo_captcha_stops_total', 'Số lần dừng vì captcha', 'counter',
      owoRows.map((r) => ({ labels: `account="${r.id}"`, value: r.o.counters?.captchaStops || 0 })));
    push('lumina_owo_claims_total', 'Số lần claim thưởng quest', 'counter',
      owoRows.map((r) => ({ labels: `account="${r.id}"`, value: r.o.counters?.claims || 0 })));
  }

  if (stats) {
    push('lumina_messages_received_total', 'Số message nhận được', 'counter', [
      { value: stats.messagesReceived || 0 },
    ]);
    push('lumina_commands_executed_total', 'Số lệnh đã chạy', 'counter', [
      { value: stats.commandsExecuted || 0 },
    ]);
    push('lumina_errors_total', 'Số lỗi phát sinh', 'counter', [{ value: stats.errors || 0 }]);
    push('lumina_voice_joins_total', 'Số lần vào voice', 'counter', [
      { value: stats.voiceJoins || 0 },
    ]);
  }

  if (session) {
    push('lumina_session_remaining_seconds', 'Số giây session còn lại (-1 = vô hạn)', 'gauge', [
      { value: session.unlimited ? -1 : Math.round((session.remaining || 0) / 1000) },
    ]);
  }

  if (health) {
    push('lumina_watchdog_enabled', 'Watchdog có bật không', 'gauge', [
      { value: health.enabled ? 1 : 0 },
    ]);
    push('lumina_watchdog_down_seconds', 'Số giây account đang mất kết nối', 'gauge',
      (health.accounts || []).map((h) => ({
        labels: `account="${h.id}"`,
        value: Math.round((h.downMs || 0) / 1000),
      })));
    push('lumina_watchdog_restarts_total', 'Số lần watchdog thử đăng nhập lại', 'counter',
      (health.accounts || []).map((h) => ({
        labels: `account="${h.id}"`,
        value: h.restarts || 0,
      })));
  }

  return lines.join('\n') + '\n';
}

function handleWho(acct, client, url) {
  const guildParam = url.searchParams.get('guild');
  const guild = resolveGuild(acct, client, guildParam);
  const list = acct.watch.listStreamers({ client, guild });
  return {
    ok: true,
    guildId: list?.guildId || guild.id,
    guildName: list?.guildName || guild.name,
    streamers: list?.streamers || [],
  };
}

async function route(method, url, req, body) {
  const p = url.pathname;

  if (method === 'GET') {
    if (p === '/api/status') {
      const acct = pickAcct(url, body);
      return statusSnapshot(acct);
    }

    if (p === '/api/accounts') {
      return {
        ok: true,
        accounts: accountSummaries(),
        focusedId: ctx.getFocusedId?.() || null,
      };
    }

    if (p === '/api/config') {
      const cfg = ctx.getConfig?.() || {};
      const stream = cfg.stream || {};
      return {
        ok: true,
        path: ctx.getConfigPath?.() || '',
        config: {
          stream: {
            enabled: stream.enabled !== false,
            width: Number(stream.width) || 0,
            height: Number(stream.height) || 0,
            fps: Number(stream.fps) || 0,
            bitrateKbps: Number(stream.bitrateKbps) || 0,
            preset: String(stream.preset || 'faster'),
            captureSource: String(stream.captureSource || ''),
            cameraDevice: String(stream.cameraDevice || ''),
            captureCursor: stream.captureCursor !== false,
            autoRestart: stream.autoRestart !== false,
            autoRestartMax: Number(stream.autoRestartMax) || 5,
            autoRestartDelayMs: Number(stream.autoRestartDelayMs) || 10000,
          },
        },
      };
    }

    if (p === '/api/guilds') {
      const acct = needAcct(url, body);
      const client = needClient(acct);
      return { ok: true, guilds: guildList(client) };
    }

    if (p === '/api/stream/who') {
      const acct = needAcct(url, body);
      return handleWho(acct, needClient(acct), url);
    }

    if (p === '/api/rpc/config') {
      const acct = needAcct(url, body);
      if (!acct.rpc?.getRpcConfig) {
        return { ok: false, error: 'Account này không có Rich Presence' };
      }
      const cfg = acct.rpc.getRpcConfig() || {};
      return { ok: true, config: cfg, path: acct.rpc.getRpcState().configPath };
    }

    if (p === '/api/channels') {
      const acct = needAcct(url, body);
      const client = needClient(acct);
      const guild = resolveGuild(acct, client, url.searchParams.get('guild'));
      const channels = [];
      for (const c of guild.channels?.cache?.values?.() || []) {
        if (channels.length >= MAX_CHANNELS_PER_GUILD) break;
        channels.push({ id: c.id, name: c.name, type: c.type });
      }
      channels.sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, guildId: guild.id, guildName: guild.name, channels };
    }

    if (p === '/api/owo') {
      const acct = needAcct(url, body);
      if (!acct.owo?.getState) {
        return { ok: false, error: 'Account này không hỗ trợ OwO' };
      }
      return { ok: true, owo: acct.owo.getState() };
    }

    if (p === '/api/snipe') {
      const channelId = str(url.searchParams.get('channel'), 25);
      if (!channelId) throw new HttpError(400, 'Cần channel ID');
      return {
        ok: true,
        channelId,
        deleted: getAllSnipes(channelId).slice(0, 10),
        edited: getAllEditSnipes(channelId).slice(0, 10),
        stats: getSnipeStats(),
      };
    }

    if (p === '/api/logs') {
      const since = Number.parseInt(url.searchParams.get('since') || '0', 10) || 0;
      return {
        ok: true,
        cursor: logCursor,
        lines: logRing.filter((e) => e.n > since),
      };
    }
  }

  if (method === 'POST') {
    if (p === '/api/accounts') {
      const token = str(body.token, 200);
      const check = checkToken(token);
      if (!check.ok) {
        throw new HttpError(400, `Token không hợp lệ: ${check.error}`);
      }
      const res = await ctx.addAccount?.({ name: str(body.name, 40), token });
      if (!res?.ok) throw new HttpError(400, res?.error || 'Thêm account thất bại');
      log.cmd(`Web: add account ${res.id}`);
      return { ok: true, message: res.message, id: res.id, name: res.name };
    }

    if (p === '/api/accounts/remove') {
      const id = str(body.id, 40);
      if (!id) throw new HttpError(400, 'Cần id account');
      const res = await ctx.removeAccount?.(id);
      if (!res?.ok) throw new HttpError(400, res?.error || 'Xoá account thất bại');
      log.cmd(`Web: remove account ${id}`);
      return { ok: true, message: res.message };
    }

    if (p === '/api/accounts/retry') {
      const id = str(body.id, 40);
      if (!id) throw new HttpError(400, 'Cần id account');
      const res = await ctx.retryAccount?.(id);
      if (!res?.ok) throw new HttpError(400, res?.error || 'Đăng nhập lại thất bại');
      log.cmd(`Web: retry account ${id}`);
      return { ok: true, message: res.message };
    }

    if (p === '/api/accounts/focus') {
      const id = str(body.id, 40);
      const ok = ctx.focusAccount?.(id);
      if (!ok) throw new HttpError(404, `Không chuyển được sang account "${id}"`);
      log.cmd(`Web: focus → ${id}`);
      return { ok: true, message: `Đã chuyển sang ${id}`, focusedId: id };
    }

    if (p === '/api/config/save') {
      const patch = body.stream && typeof body.stream === 'object' ? body.stream : null;
      if (!patch) throw new HttpError(400, 'Thiếu phần cấu hình stream');
      const file = ctx.getConfigPath?.();
      if (!file) throw new HttpError(500, 'Chưa biết đường dẫn config.json');

      let current = {};
      try {
        const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(raw || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed;
      } catch (e) {
        throw new HttpError(500, `Đọc config.json lỗi: ${e.message}`);
      }

      const next = { ...current, stream: { ...(current.stream || {}) } };
      const s = next.stream;
      if (patch.width !== undefined) s.width = numIn(patch.width, 320, 2560, 640);
      if (patch.height !== undefined) s.height = numIn(patch.height, 240, 1440, 360);
      if (patch.fps !== undefined) s.fps = numIn(patch.fps, 1, 60, 15);
      if (patch.bitrateKbps !== undefined) s.bitrateKbps = numIn(patch.bitrateKbps, 500, 8000, 1200);
      if (patch.preset !== undefined) s.preset = str(patch.preset, 20) || 'faster';
      if (patch.captureSource !== undefined) s.captureSource = str(patch.captureSource, 20);
      if (patch.cameraDevice !== undefined) s.cameraDevice = str(patch.cameraDevice, 60);
      if (patch.captureCursor !== undefined) s.captureCursor = patch.captureCursor === true;
      if (patch.autoRestart !== undefined) s.autoRestart = patch.autoRestart !== false;
      if (patch.autoRestartMax !== undefined) s.autoRestartMax = numIn(patch.autoRestartMax, 0, 20, 5);
      if (patch.autoRestartDelayMs !== undefined) {
        s.autoRestartDelayMs = numIn(patch.autoRestartDelayMs, 3000, 600000, 10000);
      }

      try {
        try { fs.copyFileSync(file, `${file}.bak`); } catch {}
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
        fs.renameSync(tmp, file);
      } catch (e) {
        throw new HttpError(500, `Ghi config.json lỗi: ${e.message}`);
      }

      const applied = ctx.reloadConfig?.();
      log.cmd('Web: lưu cấu hình stream');
      return {
        ok: true,
        message: applied && applied.ok === false
          ? `Đã lưu file nhưng không nạp lại được: ${applied.error}`
          : 'Đã lưu cấu hình stream',
        config: { stream: s },
      };
    }

    if (p === '/api/owo') {
      const acct = needAcct(url, body);
      const action = str(body.action, 20) || 'save';

      if (action === 'start') {
        const res = acct.owo.start();
        if (!res.ok) throw new HttpError(400, res.error);
        log.cmd('Web: OwO farm ON');
        return { ok: true, message: res.message, owo: acct.owo.getState() };
      }

      if (action === 'stop') {
        acct.owo.stop('web');
        log.cmd('Web: OwO farm OFF');
        return { ok: true, message: 'Đã tắt farm OwO', owo: acct.owo.getState() };
      }

      if (action === 'quest-refetch') {
        const res = await acct.owo.refetchQuests?.();
        if (!res?.ok) throw new HttpError(400, res?.error || 'Không đọc được quest log');
        log.cmd('Web: OwO đọc quest log');
        return { ok: true, message: res.message, owo: acct.owo.getState() };
      }

      if (action === 'quest-run') {
        const res = await acct.owo.runQuestsNow?.();
        if (!res?.ok) throw new HttpError(400, res?.error || 'Không chạy được quest');
        return { ok: true, message: res.message, owo: acct.owo.getState() };
      }

      const patch = {};
      if (Array.isArray(body.channelIds)) patch.channelIds = body.channelIds;
      for (const name of ['hunt', 'quest', 'gem', 'train', 'roll', 'daily']) {
        if (body[name] && typeof body[name] === 'object') patch[name] = body[name];
      }
      if (body.boss && typeof body.boss === 'object') patch.boss = body.boss;
      const next = acct.owo.setSettings(patch);
      log.cmd('Web: OwO settings saved');
      return { ok: true, message: 'Đã lưu cài đặt OwO', owo: next };
    }

    const acct = needAcct(url, body);
    const client = needClient(acct);
    const config = ctx.getConfig();
    const stats = acct.stats;
    const call = { client, config, logger: log, stats };

    if (p === '/api/voice/join') {
      if (acct.stream.isStreaming()) throw new HttpError(409, 'Đang stream — dừng stream trước khi đổi voice');
      if (acct.watch.getWatchState().active || acct.watch.getWatchState().starting) {
        throw new HttpError(409, 'Đang xem stream — dừng xem trước khi đổi voice');
      }
      const rawLink = str(body.link, 300);
      const ref = parseChannelRef(rawLink) || parseChannelRef(body.channelId);
      if (rawLink && !ref) throw new HttpError(400, 'Link kênh không hợp lệ');
      const guild = resolveGuild(acct, client, ref?.guildId || body.guildId);
      const channel = guild.channels?.cache?.get(ref?.channelId || str(body.channelId, 25));
      if (!channel) throw new HttpError(404, 'Không tìm thấy channel');
      if (!isVoiceChannel(channel)) throw new HttpError(400, `"${channel.name}" không phải voice channel`);
      if (channel.joinable === false) throw new HttpError(403, `Không thể vào "${channel.name}" (thiếu quyền?)`);
      await acct.voice.joinVoice({ ...call, guildId: guild.id, channelId: channel.id });
      log.cmd(`Web: join voice ${guild.name}/${channel.name}`);
      return { ok: true, message: `Đã vào ${channel.name} (${guild.name})` };
    }

    if (p === '/api/voice/leave') {
      if (acct.stream.isStreaming()) throw new HttpError(409, 'Đang stream — dừng stream trước khi rời voice');
      if (acct.watch.getWatchState().active || acct.watch.getWatchState().starting) {
        throw new HttpError(409, 'Đang xem stream — dừng xem trước khi rời voice');
      }
      const had = await acct.voice.leaveVoice(call);
      if (had) log.cmd('Web: leave voice');
      return { ok: true, message: had ? 'Đã rời voice' : 'Chưa ở voice nào' };
    }

    if (p === '/api/stream/start') {
      if (acct.watch.getWatchState().active || acct.watch.getWatchState().starting) {
        throw new HttpError(409, 'Đang xem stream — dừng xem trước khi stream');
      }
      const rawLink = str(body.link, 300);
      const ref = parseChannelRef(rawLink) || parseChannelRef(body.channelId);
      if (rawLink && !ref) throw new HttpError(400, 'Link kênh không hợp lệ');
      const channelId = ref?.channelId || str(body.channelId, 25);
      const source = str(body.source, 20).toLowerCase();
      const streamCall = source
        ? { ...call, config: { ...config, stream: { ...(config.stream || {}), captureSource: source } } }
        : call;
      const res = await acct.stream.startStream({ ...streamCall, channelId });
      log.cmd(`Web: stream → ${res.channelName}`);
      return { ok: true, message: `Đang stream vào ${res.channelName} (${res.guildName})` };
    }

    if (p === '/api/stream/stop') {
      const st = acct.stream.getStreamState();
      if (!st.active && !st.starting) return { ok: true, message: 'Chưa stream' };
      await acct.stream.stopStream(call);
      log.cmd('Web: stream stop');
      return { ok: true, message: 'Đã dừng stream' };
    }

    if (p === '/api/stream/pause') {
      const paused = body.paused === true;
      acct.stream.setStreamPaused(paused, { logger: log });
      log.cmd(`Web: stream ${paused ? 'pause' : 'resume'}`);
      return { ok: true, message: paused ? 'Đã tạm dừng stream' : 'Đã tiếp tục stream' };
    }

    if (p === '/api/watch/start') {
      const userId = str(body.userId, 25);
      if (!/^\d{5,25}$/.test(userId)) {
        throw new HttpError(400, 'Cần user ID hợp lệ — bấm "Ai đang stream" để lấy');
      }
      const guild = resolveGuild(acct, client, body.guildId);
      const res = await acct.watch.watchStream({ ...call, userId, guild });
      log.cmd(`Web: watch ${res.username} → ${res.file}`);
      return {
        ok: true,
        message: `Đang xem stream của ${res.username} (${res.guildName}/${res.channelName})`,
        file: res.file,
      };
    }

    if (p === '/api/watch/stop') {
      const w = acct.watch.getWatchState();
      if (!w.active && !w.starting) return { ok: true, message: 'Chưa xem stream nào' };
      const file = w.file;
      await acct.watch.stopWatch(call);
      log.cmd('Web: watch stop');
      return { ok: true, message: file ? `Đã dừng xem — ghi vào ${file}` : 'Đã dừng xem' };
    }

    if (p === '/api/afk/on') {
      const reason = str(body.reason, 200);
      acct.afk.enableAfk(reason, client.user.id);
      log.cmd(`Web: AFK ON${reason ? ` — ${reason}` : ''}`);
      return { ok: true, message: reason ? `Đã bật AFK: ${reason}` : 'Đã bật AFK' };
    }

    if (p === '/api/afk/off') {
      if (!acct.afk.getAfk().enabled) return { ok: true, message: 'AFK đang tắt' };
      acct.afk.disableAfk();
      log.cmd('Web: AFK OFF');
      return { ok: true, message: 'Đã tắt AFK' };
    }

    if (p === '/api/rpc/save') {
      const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
      const res = acct.rpc.saveRpcConfig(patch);
      if (!res.ok) throw new HttpError(400, res.error);
      const activity = await acct.rpc.reloadRPC({ force: true });
      const st = acct.rpc.getRpcState();
      log.cmd('Web: rpc.json saved');
      return {
        ok: true,
        message: activity
          ? `Đã lưu & áp dụng: ${activity.name}`
          : `Đã lưu rpc.json — chưa áp dụng được: ${st.lastError || 'lỗi không rõ'}`,
        config: res.config,
      };
    }

    if (p === '/api/rpc/reload') {
      const activity = await acct.rpc.reloadRPC({ force: true });
      if (!activity) {
        const st = acct.rpc.getRpcState();
        throw new HttpError(400, st.lastError || 'RPC không áp dụng — kiểm tra rpc.json');
      }
      log.cmd('Web: RPC reload');
      return { ok: true, message: `RPC: ${activity.name}` };
    }

    if (p === '/api/rpc/off') {
      acct.rpc.suspendRPC();
      log.cmd('Web: RPC off');
      return { ok: true, message: 'Đã tắt RPC tạm thời' };
    }
  }

  throw new HttpError(404, 'Không tìm thấy route');
}

function isAllowedOrigin(origin) {
  try {
    const o = new URL(origin);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(o.hostname);
  } catch {
    return false;
  }
}

async function handle(req, res) {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const method = req.method || 'GET';
    if (url.pathname.startsWith('/api/')) bumpRequest('web');

    // Chặn request cross-site (Origin từ trang web khác / DNS rebinding)
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      return fail(res, 403, 'Origin bị chặn');
    }

    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      let html;
      try {
        html = fs.readFileSync(WEB_DIST_INDEX, 'utf8');
      } catch {
        try {
          html = fs.readFileSync(HTML_PATH, 'utf8');
        } catch {
          return fail(res, 500, 'Thiếu src/web-dist/index.html và src/web.html');
        }
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }

    if (method === 'GET' && url.pathname.startsWith('/ui/')) {
      const name = path.basename(url.pathname);
      const type = UI_TYPES[path.extname(name).toLowerCase()];
      const file = path.join(WEB_DIST_ASSETS, name);
      if (!type || !file.startsWith(WEB_DIST_ASSETS + path.sep)) {
        return fail(res, 404, 'Không có file UI');
      }
      let data;
      try {
        data = fs.readFileSync(file);
      } catch {
        return fail(res, 404, 'Không có file UI');
      }
      // Tên file có hash từ Vite nên cache dài hạn an toàn
      res.writeHead(200, {
        'content-type': type,
        'cache-control': 'public, max-age=31536000, immutable',
      });
      return res.end(data);
    }

    if (method === 'GET' && url.pathname.startsWith('/assets/')) {
      const name = path.basename(url.pathname);
      const type = ASSET_TYPES[path.extname(name).toLowerCase()];
      const file = path.join(ASSETS_DIR, name);
      if (!type || !file.startsWith(ASSETS_DIR + path.sep)) {
        return fail(res, 404, 'Không có asset');
      }
      let data;
      try {
        data = fs.readFileSync(file);
      } catch {
        return fail(res, 404, 'Không có asset');
      }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      return res.end(data);
    }

    if (method === 'GET' && url.pathname === '/api/metrics') {
      res.writeHead(200, {
        'content-type': 'text/plain; version=0.0.4; charset=utf-8',
        'cache-control': 'no-store',
      });
      return res.end(buildMetrics());
    }

    if (!['GET', 'POST'].includes(method)) {
      return fail(res, 405, 'Method không hỗ trợ');
    }

    // POST từ trình duyệt cần custom header — trang web khác không gửi được
    // nếu không qua CORS preflight (server này không trả CORS header)
    if (method === 'POST' && req.headers['x-lumina'] !== 'web') {
      return fail(res, 403, 'Thiếu header x-lumina');
    }

    const body = method === 'POST' ? await readJsonBody(req) : {};
    const result = await route(method, url, req, body);
    return json(res, 200, result);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const msg = e?.message || String(e);
    if (status === 500) log.error(`Web: ${msg}`);
    return fail(res, status, msg);
  }
}

export async function startWebServer(options = {}) {
  Object.assign(ctx, options);

  const config = ctx.getConfig() || {};
  serverPort = Math.min(65535, Math.max(1024, Number.parseInt(config.web?.port, 10) || 8787));

  const s = http.createServer((req, res) => {
    void handle(req, res);
  });

  s.on('error', (e) => {
    log.error(`Web server: ${e.message}`);
  });

  await new Promise((resolve, reject) => {
    s.once('error', reject);
    s.listen(serverPort, '127.0.0.1', () => {
      s.removeListener('error', reject);
      resolve();
    });
  });

  server = s;
  return { url: `http://127.0.0.1:${serverPort}`, port: serverPort };
}

export function stopWebServer() {
  if (!server) return;
  try { server.close(); } catch {}
  server = null;
}

export function getWebUrl() {
  return server ? `http://127.0.0.1:${serverPort}` : null;
}
