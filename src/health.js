import { sleep } from './utils.js';
import { nextBackoffMs, randInt } from './antiDetect.js';

// Watchdog: quét định kỳ xem account nào mất kết nối, chờ một khoảng "grace"
// rồi mới tự đăng nhập lại. Account đang có voice/stream được ưu tiên vì
// voice có timeout server-side, mất vài giây là thấy ngay.
//
// Bản port từ afterlife (bot/worker/client_health.py + center/recovery.py):
//   - health scan định kỳ, dọn client chết
//   - grace period: mất heartbeat thì chờ, coi như restart bình thường
//   - khi khôi phục nhiều account: ưu tiên account có voice, giãn cách login

const DEFAULTS = {
  enabled: true,
  intervalMs: 10000,
  graceMs: 90000,
  restartSpacingMs: 1500,
  restartSpacingJitterMs: 750,
  backoffBaseMs: 5000,
  backoffMaxMs: 300000,
  backoffJitterRatio: 0.25,
};

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function createHealthWatch({
  config,
  logger,
  getAccounts,
  restartAccount,
  isShuttingDown,
}) {
  const raw = config?.health || {};
  const enabled = raw.enabled !== false;
  const intervalMs = clampInt(raw.intervalMs, DEFAULTS.intervalMs, 2000, 600000);
  const graceMs = clampInt(raw.graceMs, DEFAULTS.graceMs, 0, 900000);
  const spacingMs = clampInt(raw.restartSpacingMs, DEFAULTS.restartSpacingMs, 0, 60000);
  const spacingJitterMs = clampInt(raw.restartSpacingJitterMs, DEFAULTS.restartSpacingJitterMs, 0, 60000);
  const backoffBaseMs = clampInt(raw.backoffBaseMs, DEFAULTS.backoffBaseMs, 500, 600000);
  const backoffMaxMs = clampInt(raw.backoffMaxMs, DEFAULTS.backoffMaxMs, 1000, 3600000);
  const backoffJitterRatio = clampInt(raw.backoffJitterRatio, DEFAULTS.backoffJitterRatio, 0, 100) / 100;

  const perAccount = new Map();

  function stateFor(id) {
    let st = perAccount.get(id);
    if (!st) {
      st = { suspectSince: 0, restarts: 0, nextAttemptAt: 0, lastOkAt: 0, backoffMs: 0 };
      perAccount.set(id, st);
    }
    return st;
  }

  function isHealthy(acct) {
    if (!acct || acct.permanentError) return false;
    const client = acct.client;
    if (!client) return false;
    try {
      return client.isReady() === true;
    } catch {
      return false;
    }
  }

  // Ưu tiên account đang giữ voice/stream khi phải restart.
  function priority(acct) {
    try {
      if (acct.voice?.getVoiceState?.().connected) return 3;
      if (acct.stream?.getStreamState?.().active) return 2;
      if (acct.watch?.getWatchState?.().active) return 1;
    } catch {}
    return 0;
  }

  let timer = null;
  let scanning = false;
  let lastRestartAt = 0;

  async function tick() {
    if (scanning) return;
    scanning = true;
    try {
      const now = Date.now();
      const list = getAccounts?.() || [];
      const candidates = [];

      for (const acct of list) {
        const st = stateFor(acct.id);

        if (isHealthy(acct)) {
          if (st.suspectSince) {
            st.suspectSince = 0;
            logger?.info(`[${acct.name}] Kết nối đã trở lại`);
          }
          st.lastOkAt = now;
          // Đã phục hồi — reset backoff để lần rớt sau bắt đầu lại từ đầu,
          // đừng cộng dồn mức lùi của một đợt lỗi đã qua.
          st.backoffMs = 0;
          continue;
        }

        if (acct.permanentError || acct.restarting) continue;

        if (!st.suspectSince) {
          st.suspectSince = now;
          logger?.warn(
            `[${acct.name}] Mất kết nối — chờ ${Math.round(graceMs / 1000)}s rồi thử lại`,
          );
          continue;
        }

        if (now - st.suspectSince < graceMs) continue;
        if (now < st.nextAttemptAt) continue;

        candidates.push({ acct, st });
      }

      if (!candidates.length) return;

      candidates.sort((a, b) => priority(b.acct) - priority(a.acct));

      for (const { acct, st } of candidates) {
        if (isShuttingDown?.()) return;

        // Giãn cách giữa các lần restart + jitter: nhiều account cùng rớt mạng
        // sẽ không đồng loạt đăng nhập lại đúng một mốc thời gian.
        const wait = Math.max(0, lastRestartAt + spacingMs - Date.now())
          + (spacingJitterMs > 0 ? randInt(0, spacingJitterMs) : 0);
        if (wait) await sleep(wait);
        lastRestartAt = Date.now();

        st.restarts += 1;
        st.suspectSince = 0;

        // Backoff nhân 2 có jitter (port _next_delay() của ghosty-owo) — nhịp lùi
        // đều tăm tắm dễ bị nhận ra, và dồn nhiều account vào cùng một mốc thời
        // gian cũng dễ kích hoạt giới hạn từ phía Discord.
        st.backoffMs = nextBackoffMs(st.backoffMs || backoffBaseMs, {
          baseMs: backoffBaseMs,
          factor: 2,
          maxMs: backoffMaxMs,
          jitterRatio: backoffJitterRatio,
        });
        st.nextAttemptAt = Date.now() + st.backoffMs;

        logger?.warn(`[${acct.name}] Tự đăng nhập lại (lần ${st.restarts})...`);
        try {
          await restartAccount(acct);
        } catch (e) {
          logger?.error(`[${acct.name}] Restart lỗi: ${e?.message || e}`);
        }
      }
    } finally {
      scanning = false;
    }
  }

  function start() {
    if (!enabled || timer) return;
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function snapshot() {
    const accounts = [];
    for (const [id, st] of perAccount) {
      accounts.push({
        id,
        restarts: st.restarts,
        downMs: st.suspectSince ? Date.now() - st.suspectSince : 0,
        lastOkAt: st.lastOkAt,
        nextAttemptAt: st.nextAttemptAt,
        backoffMs: st.backoffMs,
      });
    }
    return {
      enabled,
      intervalMs,
      graceMs,
      spacingMs,
      spacingJitterMs,
      backoffBaseMs,
      backoffMaxMs,
      backoffJitterRatio,
      accounts,
    };
  }

  function resetAccount(id) {
    perAccount.delete(id);
  }

  return { start, stop, tick, snapshot, stateFor, resetAccount };
}
