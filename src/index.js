import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSelfbotClient, loadAllowedChannels } from './client.js';
import { makeLogger, setDebug, setOutput, log as rootLog } from './logger.js';
import { setShuttingDown, isShuttingDown } from './shutdown.js';
import { sleep, fmtDur, auditSecretFile } from './utils.js';
import { randInt } from './antiDetect.js';
import { createDashboard } from './dashboard.js';
import { createSession, logSessionEnd } from './session.js';
import { createStats } from './stats.js';
import { loadConfig } from './config.js';
import {
  loadAccountDefs,
  addAccountToStore,
  removeAccountFromStore,
  makeAccountId,
} from './accounts.js';
import { createAccount } from './account.js';
import { createHealthWatch } from './health.js';
import { parseUserToken } from './tokenParse.js';
import {
  loadCommandFiles,
  buildDispatcher,
  startConsole,
} from './commands/index.js';
import { startWebServer, stopWebServer, pushWebLog } from './web.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CONFIG_PATH = path.join(ROOT, 'config.json');
const CHANNEL_PATH = path.join(ROOT, 'channel.txt');
const TOKENS_PATH = path.join(ROOT, 'tokens.txt');

const accounts = new Map();
let focusedId = null;
let storeFile = 'tokens.txt';
let currentConfig = null;
let consoleRl = null;
let session = null;
let stopped = false;
let activeDashboard = null;
let dashTimer = null;
let healthWatch = null;
let crashExit = false;
let sessionExpired = false;

function exitCode() {
  if (sessionExpired) return 3;
  if (crashExit) return 1;
  return 0;
}

function destroyAllClients() {
  for (const acct of accounts.values()) {
    try { acct.client?.destroy(); } catch {}
  }
}

function requestShutdown() {
  if (isShuttingDown()) {
    destroyAllClients();
    try { activeDashboard?.destroy(); } catch {}
    process.exit(exitCode());
  }
  setShuttingDown(true);
  rootLog.warn('Đang dừng selfbot...');
}
globalThis.__sbStop = () => requestShutdown();

// ── Quản lý nhiều account ────────────────────────────────
function accountList() {
  return [...accounts.values()].map((a) => ({
    id: a.id,
    name: a.name,
    ready: a.ready,
    error: a.error,
    startedAt: a.startedAt,
    user: a.client?.user ? { tag: a.client.user.tag, id: a.client.user.id } : null,
    restarts: a.restarts || 0,
    permanentError: !!a.permanentError,
  }));
}

function focusedAccount() {
  return focusedId ? accounts.get(focusedId) || null : null;
}

function focusAccount(id) {
  if (!id || !accounts.has(id)) return false;
  focusedId = id;
  const acct = accounts.get(id);
  try { activeDashboard?.setAccounts(accountList(), focusedId); } catch {}
  rootLog.info(`Focus → ${acct.name} (${acct.id})`);
  return true;
}

function cycleFocus() {
  const ids = [...accounts.keys()];
  if (!ids.length) return false;
  const idx = ids.indexOf(focusedId);
  return focusAccount(ids[(idx + 1) % ids.length]);
}

// ── Dừng 1 account (dùng khi xoá) ─────────────────────────
async function stopAccount(acct) {
  const logger = makeLogger('sb');

  try {
    const st = acct.stream.getStreamState();
    if (st.active || st.starting) {
      await acct.stream.stopStream({
        client: acct.client,
        config: currentConfig,
        logger,
        stats: acct.stats,
        restore: false,
        reason: 'removed',
      });
    }
  } catch {}

  try {
    const w = acct.watch.getWatchState();
    if (w.active || w.starting) {
      await acct.watch.stopWatch({
        client: acct.client,
        config: currentConfig,
        logger,
        stats: acct.stats,
        restore: false,
        reason: 'removed',
      });
    }
  } catch {}

  try {
    const vs = acct.voice.getVoiceState();
    if (vs.connected) await acct.voice.leaveVoice({ logger, stats: acct.stats });
  } catch {}

  try { acct.rpc.stopRPC(); } catch {}
  try { acct.afk.flushAfk(); } catch {}
  try { acct.owo.dispose(); } catch {}

  if (acct.client) {
    try { await acct.client.destroy(); } catch {}
    acct.client = null;
  }
}

// ── Thêm / xoá account lúc chạy (web panel) ─────────────────
async function addAccount({ name, token }) {
  const tokenStr = String(token || '').trim();
  if (!tokenStr) return { ok: false, error: 'Cần token' };

  const parsed = parseUserToken(tokenStr);
  if (!parsed.ok) return { ok: false, error: `Token không hợp lệ: ${parsed.error}` };

  for (const acct of accounts.values()) {
    const other = parseUserToken(acct.token);
    if (other.ok && other.discordId === parsed.discordId) {
      return { ok: false, error: `Token này đã có trong danh sách (account "${acct.name}")` };
    }
  }

  const usedIds = new Set(accounts.keys());
  const acctName = String(name || '').trim() || `Account ${accounts.size + 1}`;
  const id = makeAccountId(acctName, usedIds);

  let index;
  try {
    index = addAccountToStore({ root: ROOT, file: storeFile, name: acctName, token: tokenStr });
  } catch (e) {
    return { ok: false, error: `Không lưu được token: ${e.message}` };
  }

  const def = { id, name: acctName, token: tokenStr, primary: false, file: storeFile, index };
  const acct = await startAccount(def, currentConfig);

  if (!acct?.ready) {
    return {
      ok: false,
      error: acct?.error || 'Đăng nhập thất bại',
      id,
      name: acctName,
    };
  }

  return {
    ok: true,
    message: `Đã thêm account ${acctName} (${id}) — user ${parsed.discordId}`,
    id,
    name: acctName,
    discordId: parsed.discordId,
  };
}

async function removeAccount(id) {
  const acct = accounts.get(id);
  if (!acct) return { ok: false, error: `Không có account "${id}"` };

  await stopAccount(acct);
  accounts.delete(id);

  try {
    removeAccountFromStore({
      root: ROOT,
      file: acct.file || storeFile,
      index: acct.index,
    });
  } catch {}

  if (focusedId === id) {
    focusedId = null;
    const next = accountList().find((a) => a.ready) || accountList()[0];
    if (next) focusAccount(next.id);
  }

  try { activeDashboard?.setAccounts(accountList(), focusedId); } catch {}
  rootLog.ok(`Đã xoá account ${acct.name} (${acct.id})`);
  return { ok: true, message: `Đã xoá account ${acct.name}` };
}

// ── Khởi động 1 account ──────────────────────────────────
async function startAccount(def, config) {
  const logger = makeLogger('sb');
  const stats = createStats();

  const peersFor = (selfId) => () => [...accounts.values()].filter(
    (a) => a.id !== selfId && a.ready && a.client?.user,
  );

  const acct = createAccount({
    id: def.id,
    name: def.name,
    token: def.token,
    config,
    logger,
    stats,
    session,
    root: ROOT,
    primary: !!def.primary,
    getPeers: peersFor(def.id),
  });
  acct.file = def.file || storeFile;
  acct.index = Number.isInteger(def.index) ? def.index : -1;
  accounts.set(def.id, acct);

  acct.dispatcher = buildDispatcher({
    config,
    logger,
    stats,
    session,
    acct,
    getAccounts: accountList,
    getFocusedId: () => focusedId,
    focusAccount,
  });

  const ok = await attachClient(acct);
  if (!ok) return acct;

  try {
    await acct.rpc.applyRPCFromConfig({ startup: true, quiet: true });
  } catch (e) {
    logger.warn(`[${acct.name}] RPC apply fail: ${e.message}`);
  }

  logger.ok(`[${acct.name}] Selfbot ready: ${acct.client.user.tag}`);
  return acct;
}

// Tạo client mới + đăng nhập cho account (dùng cho lần khởi động đầu
// và cho watchdog đăng nhập lại).
async function attachClient(acct) {
  const logger = acct.logger;
  const client = createSelfbotClient({
    config: acct.config,
    logger,
    stats: acct.stats,
    dispatcher: acct.dispatcher,
    acct,
  });
  acct.client = client;
  acct.ready = false;
  acct.error = '';

  client.once('invalidated', () => {
    // Chỉ account này chết — bot và các account khác vẫn chạy.
    acct.error = 'invalidated';
    acct.permanentError = true;
    acct.ready = false;
    logger.error(`[${acct.name}] Client bị invalidated (token hết hiệu lực, bị kick)`);
    try { activeDashboard?.setAccounts(accountList(), focusedId); } catch {}
  });

  try {
    await client.login(acct.token);
  } catch (e) {
    acct.error = e?.message || String(e);
    logger.error(`[${acct.name}] Login lỗi: ${acct.error}`);
    acct.client = null;
    return false;
  }

  if (!client.user) {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 20000);
      client.once('ready', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  if (!client.user) {
    acct.error = 'không ready sau 20s';
    logger.error(`[${acct.name}] Selfbot không ready sau 20s`);
    try { await client.destroy(); } catch {}
    acct.client = null;
    return false;
  }

  acct.ready = true;
  acct.startedAt = Date.now();
  return true;
}

// ── Tự đăng nhập lại 1 account (watchdog) ───────────────────
async function restartAccount(acct) {
  const logger = acct.logger || makeLogger('sb');
  if (acct.restarting) return false;
  acct.restarting = true;
  acct.ready = false;

  try {
    return await doRestart(acct, logger);
  } finally {
    acct.restarting = false;
  }
}

async function doRestart(acct, logger) {

  // Giữ lại chỗ đang đứng để vào lại sau khi đăng nhập
  let voiceTarget = null;
  try {
    const vs = acct.voice.getVoiceState();
    if (vs.connected && vs.guildId && vs.channelId) {
      voiceTarget = { guildId: vs.guildId, channelId: vs.channelId };
    }
  } catch {}

  let streamTarget = null;
  try {
    const st = acct.stream.getStreamState();
    if (st.active && st.channelId) streamTarget = { channelId: st.channelId };
  } catch {}

  try {
    if (acct.client) {
      const st = acct.stream.getStreamState();
      if (st.active || st.starting) {
        await acct.stream.stopStream({
          client: acct.client,
          config: currentConfig,
          logger,
          stats: acct.stats,
          restore: false,
          reason: 'restart',
        });
      }
    }
  } catch {}

  try {
    if (acct.client) {
      try { await acct.client.destroy(); } catch {}
    }
    acct.client = null;
  } catch {}

  const ok = await attachClient(acct);
  if (!ok) {
    logger.error(`[${acct.name}] Đăng nhập lại thất bại: ${acct.error}`);
    return false;
  }

  acct.restarts = (acct.restarts || 0) + 1;
  acct.permanentError = false;

  try {
    await acct.rpc.applyRPCFromConfig({ startup: true, quiet: true });
  } catch (e) {
    logger.warn(`[${acct.name}] RPC apply fail: ${e.message}`);
  }

  // Voice trước — phiên voice trên Discord có timeout ngắn
  if (voiceTarget) {
    try {
      await waitForGuild(acct.client, voiceTarget.guildId, 20000);
      await acct.voice.joinVoice({
        client: acct.client,
        guildId: voiceTarget.guildId,
        channelId: voiceTarget.channelId,
        config: currentConfig,
        logger,
        stats: acct.stats,
      });
      logger.ok(`[${acct.name}] Đã vào lại voice`);
    } catch (e) {
      logger.warn(`[${acct.name}] Không vào lại được voice: ${e?.message || e}`);
    }
  }

  if (streamTarget) {
    try {
      await acct.stream.startStream({
        client: acct.client,
        channelId: streamTarget.channelId,
        config: currentConfig,
        logger,
        stats: acct.stats,
      });
      logger.ok(`[${acct.name}] Đã stream lại`);
    } catch (e) {
      logger.warn(`[${acct.name}] Không stream lại được: ${e?.message || e}`);
    }
  }

  logger.ok(`[${acct.name}] Đã đăng nhập lại (lần ${acct.restarts})`);
  try { activeDashboard?.setAccounts(accountList(), focusedId); } catch {}
  return true;
}

// Chờ guild xuất hiện trong cache (sau khi login mới có danh sách guild)
async function waitForGuild(client, guildId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (client?.guilds?.cache?.has(guildId)) return true;
    await sleep(500);
  }
  return false;
}

// Thử đăng nhập lại 1 account (nút "Thử lại" trong web panel)
async function retryAccount(id) {
  const acct = accounts.get(id);
  if (!acct) return { ok: false, error: `Không có account "${id}"` };
  if (acct.restarting) return { ok: false, error: `${acct.name} đang đăng nhập lại` };
  if (acct.ready && !acct.permanentError) {
    return { ok: false, error: `${acct.name} đang chạy bình thường` };
  }

  acct.permanentError = false;
  acct.error = '';

  const ok = await restartAccount(acct);
  if (!ok) return { ok: false, error: acct.error || 'Đăng nhập thất bại' };
  return { ok: true, message: `Đã đăng nhập lại ${acct.name}` };
}

// ── Dashboard ─────────────────────────────────────────────
function refreshDashboard() {
  const acct = focusedAccount();
  if (!acct) return;

  const dashboard = activeDashboard;
  if (!dashboard) return;

  const client = acct.client;
  try {
    dashboard.setAccounts(accountList(), focusedId);
    dashboard.setUser(client?.user);
    dashboard.setStatus(acct.ready ? 'ONLINE' : 'CONNECTING');
    dashboard.setGuilds(client?.guilds?.cache?.size || 0);
    dashboard.setPing(client?.ws?.ping ?? 0);
    dashboard.setSessionMax(currentConfig?.sessionMaxMinutes || 360);
    if (session) dashboard.setSessionElapsed(session.elapsedMs());
    dashboard.setStats(acct.stats.snapshot());
    dashboard.setAfk(acct.afk.getAfk());
    dashboard.setStream(acct.stream.getStreamState());
    dashboard.setRpc(acct.rpc.getRpcState());
    dashboard.setOwo(acct.owo?.getState?.());

    const st = acct.stream.getStreamState();
    const w = acct.watch.getWatchState();
    const vs = acct.voice.getVoiceState();

    if (st.active) {
      const g = client.guilds.cache.get(st.guildId);
      const c = g?.channels?.cache?.get(st.channelId);
      const liveFor = fmtDur((Date.now() - st.startedAt) / 1000);
      const paused = st.paused ? ' (paused)' : '';
      dashboard.setVoice(`${g?.name || '?'} / ${c?.name || '?'} · LIVE${paused} ${liveFor}`);
    } else if (st.starting) {
      dashboard.setVoice('Starting stream...');
    } else if (w.active) {
      dashboard.setVoice(
        `${w.channelName || '?'} · WATCH ${w.username || w.userId} ${fmtDur((Date.now() - w.startedAt) / 1000)}`,
      );
    } else if (vs.connected) {
      const g = client.guilds.cache.get(vs.guildId);
      const c = g?.channels?.cache?.get(vs.channelId);
      dashboard.setVoice(`${g?.name || '?'} / ${c?.name || '?'}`);
    } else {
      dashboard.setVoice('Not connected');
    }
  } catch {}
}

// ── Dừng ─────────────────────────────────────────────────
async function stopSelfbot(dashboard) {
  if (stopped) return;
  stopped = true;

  const logger = makeLogger('sb');

  if (dashTimer) {
    clearInterval(dashTimer);
    dashTimer = null;
  }

  try { stopWebServer(); } catch {}

  if (healthWatch) {
    try { healthWatch.stop(); } catch {}
    healthWatch = null;
  }

  if (session) {
    session.stop();
    const logPath = path.resolve(ROOT, currentConfig?.sessionLogFile || 'session.log');
    logSessionEnd({ session, path: logPath, logger });
    session = null;
  }

  if (consoleRl) {
    try { consoleRl.close(); } catch {}
    consoleRl = null;
  }

  for (const acct of accounts.values()) {
    try {
      const st = acct.stream.getStreamState();
      if (st.active || st.starting) {
        await acct.stream.stopStream({
          client: acct.client,
          config: currentConfig,
          logger,
          stats: acct.stats,
          restore: false,
          reason: 'shutdown',
        });
      }
    } catch {}

    try {
      const w = acct.watch.getWatchState();
      if (w.active || w.starting) {
        await acct.watch.stopWatch({
          client: acct.client,
          config: currentConfig,
          logger,
          stats: acct.stats,
          restore: false,
          reason: 'shutdown',
        });
      }
    } catch {}

    try {
      const vs = acct.voice.getVoiceState();
      if (vs.connected) {
        await acct.voice.leaveVoice({ logger, stats: acct.stats });
      }
    } catch {}

    try { acct.rpc.stopRPC(); } catch {}
    try { acct.afk.flushAfk(); } catch {}

    if (acct.client) {
      try {
        await acct.client.destroy();
        logger.ok(`Đã dừng ${acct.name}`);
      } catch (e) {
        logger.error(`[${acct.name}] Destroy lỗi: ${e.message}`);
      }
      acct.client = null;
    }
  }

  accounts.clear();
  focusedId = null;

  try { dashboard?.setVoice('Not connected'); } catch {}
  try { dashboard?.setRunning(false); } catch {}
  try { dashboard?.setStatus('OFFLINE'); } catch {}
}

async function main() {
  let loaded;
  try {
    loaded = loadConfig(CONFIG_PATH);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }

  const config = loaded.config;
  currentConfig = config;
  setDebug(config.debug);

  const dashboard = createDashboard({
    onQuit: () => requestShutdown(),
    onSwitchAccount: (id) => {
      if (id) focusAccount(id);
      else cycleFocus();
    },
    headless: config.dashboard === false,
  });
  activeDashboard = dashboard;
  setOutput((line) => {
    dashboard.appendLog(line);
    pushWebLog(line);
  });

  for (const warning of loaded.warnings) {
    rootLog.warn(`Config: ${warning}`);
  }

  auditSecretFile(TOKENS_PATH, 'tokens.txt');
  auditSecretFile(path.join(ROOT, 'rpc.json'), 'rpc.json');

  // ── Danh sách account ───────────────────────────────────
  const defs = loadAccountDefs({ root: ROOT });
  storeFile = defs.file || storeFile;
  for (const warning of defs.warnings) {
    rootLog.warn(`Accounts: ${warning}`);
  }

  const envName = config.tokenEnv || 'DISCORD_TOKEN';
  const envToken = envName ? String(process.env[envName] || '').trim() : '';

  if (!defs.accounts.length && envToken) {
    defs.accounts.push({ id: 'default', name: 'Account 1', token: envToken, primary: true });
    rootLog.info(`Dùng token từ env ${envName}`);
  } else if (defs.accounts.length && envToken) {
    rootLog.warn(`Bỏ qua env ${envName} — đã có danh sách account trong tokens.txt/accounts.json`);
  }

  if (!defs.accounts.length) {
    rootLog.error(
      `Không có token — đặt ${envName} hoặc tạo ${TOKENS_PATH} / accounts.json`,
    );
    try { dashboard.destroy(); } catch {}
    // 2 = thiếu cấu hình: chạy lại cũng hỏng y vậy, wrapper dừng ngay thay vì retry 4 lần
    process.exit(2);
  }

  loadAllowedChannels(CHANNEL_PATH);

  // ── Session (dùng chung cho cả process) ────────────────
  session = createSession({
    config,
    logger: makeLogger('sb'),
    onWarn: ({ remainMs }) => {
      rootLog.warn(`Session sắp hết — còn ${fmtDur(remainMs / 1000)}`);
    },
    onExpire: () => {
      sessionExpired = true;
      rootLog.warn('Session đã hết');
    },
  });

  // ── Commands (đăng ký 1 lần, dùng chung) ───────────────
  const loadedCount = await loadCommandFiles({ logger: makeLogger('sb'), dashboard });
  rootLog.info(`Loaded ${loadedCount} command files`);

  // ── Web panel ───────────────────────────────────────────
  if (config.web?.enabled !== false) {
    try {
      const web = await startWebServer({
        getClient: () => focusedAccount()?.client || null,
        getConfig: () => currentConfig,
        getStats: () => focusedAccount()?.stats || null,
        getSession: () => session,
        getAccounts: accountList,
        getFocusedId: () => focusedId,
        focusAccount,
        getAccount: (id) => accounts.get(id) || null,
        addAccount,
        removeAccount,
        retryAccount,
        getHealth: () => healthWatch?.snapshot() || null,
        getConfigPath: () => CONFIG_PATH,
        reloadConfig: () => {
          try {
            const loaded = loadConfig(CONFIG_PATH);
            currentConfig = loaded.config;
            for (const acct of accounts.values()) acct.config = currentConfig;
            return { ok: true, config: currentConfig };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        },
      });
      rootLog.ok(`Web panel: ${web.url}`);
    } catch (e) {
      rootLog.warn(`Web không khởi động được: ${e.message}`);
    }
  }

  // ── Watchdog: tự đăng nhập lại account rớt mạng ───────────
  healthWatch = createHealthWatch({
    config,
    logger: makeLogger('sb'),
    getAccounts: () => [...accounts.values()],
    restartAccount,
    isShuttingDown,
  });

  process.on('SIGINT', () => requestShutdown());
  process.on('SIGTERM', () => requestShutdown());

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason ?? '');
    rootLog.error(`Unhandled rejection: ${msg}`);
    try { focusedAccount()?.stats?.bump('errors'); } catch {}
  });

  process.on('uncaughtException', (e) => {
    rootLog.error(`Uncaught exception: ${e?.message || e}`);
    try { focusedAccount()?.stats?.bump('errors'); } catch {}
    crashExit = true;
    requestShutdown();
  });

  process.on('warning', (w) => {
    try { rootLog.debug?.(`Node warning: ${w?.name || ''} ${w?.message || ''}`.trim()); } catch {}
  });

  // ── Khởi động lần lượt từng account ────────────────────
  const staggerMs = Math.max(0, Number(config.accounts?.startDelayMs) || 0);
  const staggerJitterMs = Math.max(0, Number(config.accounts?.startDelayJitterMs) || 0);
  let readyCount = 0;

  for (let i = 0; i < defs.accounts.length; i++) {
    const def = defs.accounts[i];
    if (isShuttingDown()) break;

    if (!def.token) {
      rootLog.error(`Bỏ qua account "${def.name}" — không có token`);
      continue;
    }

    const acct = await startAccount(def, config);
    if (acct?.ready) readyCount++;

    if (i < defs.accounts.length - 1 && !isShuttingDown()) {
      // Lệch pha giữa các account + jitter. Cả đám đăng nhập đúng một mốc
      // thời gian để lại dấu vết rõ hơn nhiều so với đăng nhập lẻ lẻ.
      const wait = staggerMs
        + (staggerJitterMs > 0 ? randInt(-staggerJitterMs, staggerJitterMs) : 0);
      if (wait > 0) await sleep(wait);
    }
  }

  if (isShuttingDown()) {
    await stopSelfbot(dashboard);
    try { dashboard.destroy(); } catch {}
    process.exit(exitCode());
  }

  if (!readyCount) {
    if (config.web?.enabled !== false) {
      rootLog.warn('Không account nào đăng nhập được — bot vẫn chạy, thêm token trong web panel');
    } else {
      rootLog.error('Không account nào đăng nhập được — thoát');
      await stopSelfbot(dashboard);
      try { dashboard.destroy(); } catch {}
      process.exit(1);
    }
  }

  // Focus account đầu tiên
  const firstReady = accountList().find((a) => a.ready);
  focusAccount(firstReady?.id || accountList()[0]?.id);

  // Bật watchdog sau khi các account ban đầu đã đăng nhập xong, tránh
  // flag nhầm lúc account còn đang vào.
  healthWatch.start();
  const hs = healthWatch.snapshot();
  if (hs.enabled) {
    rootLog.info(
      `Watchdog: quét mỗi ${hs.intervalMs / 1000}s, chờ ${hs.graceMs / 1000}s rồi đăng nhập lại`,
    );
  }

  session.start();

  dashTimer = setInterval(() => {
    if (isShuttingDown()) return;
    refreshDashboard();
  }, 2000);

  // ── Console ─────────────────────────────────────────────
  if (config.commands?.consoleEnabled !== false) {
    consoleRl = startConsole({
      getDispatcher: () => focusedAccount()?.dispatcher || null,
      config,
      logger: makeLogger('sb'),
    });
  }

  rootLog.ok(`Đang chạy ${readyCount}/${defs.accounts.length} account — focus: ${focusedId}`);

  let warnedNoAccount = false;
  let lastAliveAt = Date.now();

  while (!isShuttingDown()) {
    await sleep(1000);

    let anyAlive = false;
    for (const acct of accounts.values()) {
      if (acct.ready && acct.client) {
        anyAlive = true;
        break;
      }
    }

    if (anyAlive) {
      lastAliveAt = Date.now();
      warnedNoAccount = false;
      continue;
    }

    // Watchdog đang xử lý → chờ, đừng vội tắt bot
    if (Date.now() - lastAliveAt < 120000) continue;

    if (!warnedNoAccount) {
      warnedNoAccount = true;
      if (config.web?.enabled !== false) {
        rootLog.warn('Chưa có account nào chạy — thêm token trong web panel để bắt đầu');
      } else {
        rootLog.warn('Mọi account đã mất kết nối — tự động thoát');
        crashExit = true;
        setShuttingDown(true);
        break;
      }
    }
  }

  await stopSelfbot(dashboard);
  try { dashboard.destroy(); } catch {}
  process.exit(exitCode());
}

main().catch((e) => {
  console.error(e);
  destroyAllClients();
  process.exit(1);
});
