// src/antiDetect.js
// Bộ nhịp (pacing engine) — thay các khoảng chờ "cứng" bằng phân phối xác suất,
// backoff có jitter, cửa sổ hoạt động và chu kỳ làm/nghỉ.
//
// Cổng bịch từ ghosty-owo (Lumina OwO v1 Alpha):
//   core/bossmodule.py → calculate_boss_delay(): delay phân phối Gauss quanh
//                        midpoint, clamp vào [min,max] — 68% rơi trong mid±spread
//   main.py            → _next_delay(): backoff nhân 2, cap, cộng/trừ jitter 25%
//   core/modules.py    → SPEED_MODES: action_delay_min/max, random_long_delay,
//                        work/break, day_skip
//
// Vì sao cần: một bot gửi lệnh đúng nhịp máy móc (mỗi 20.000ms một lần, không
// bao giờ lệch) tạo ra dấu vết thống kê rất đặc trưng. Người thật thì phải
// chờ, phải nghỉ, phải lúc bận lúc rảnh — và chính sự bất quy tắc đó làm cho
// lưu lượng trông giống hành vi bình thường hơn là một dãy số đều tăm tắp.

import { sleep } from './utils.js';

// ── Tiện ích số ─────────────────────────────────────────────

export function clampMs(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function randInt(min, max) {
  const a = Math.ceil(Math.min(min, max));
  const b = Math.floor(Math.max(min, max));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return a || 0;
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

/** Trễ đều trong [minMs, maxMs] — dùng khi chỉ cần "không đều", không cần hình dạng phân phối. */
export function jitterMs(minMs, maxMs) {
  return randInt(clampMs(minMs, 0, Number.MAX_SAFE_INTEGER), clampMs(maxMs, 0, Number.MAX_SAFE_INTEGER));
}

// Box-Muller: sinh hai số phân phối chuẩn từ một cặp số đều (0,1].
function gaussianSample(mean, stdDev) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Delay phân phối Gauss quanh giữa khoảng, clamp về [minMs, maxMs].
 * `spreadRatio` = tỉ lệ của bề rộng khoảng dùng làm độ lệch chuẩn.
 * Mặc định 0.25 → khoảng 68% số lần rơi trong mid ± (max-min)/4, đúng công thức
 * của calculate_boss_delay() bên ghosty-owo.
 */
export function gaussianMs(minMs, maxMs, spreadRatio = 0.25) {
  const lo = clampMs(minMs, 0, Number.MAX_SAFE_INTEGER);
  const hi = clampMs(maxMs, 0, Number.MAX_SAFE_INTEGER);
  if (hi <= lo) return lo;

  const mid = (lo + hi) / 2;
  const stdDev = Math.max(1, (hi - lo) * spreadRatio);
  const sample = gaussianSample(mid, stdDev);
  return clampMs(sample, lo, hi);
}

/**
 * Backoff nhân 2, có cap, cộng/trừ jitter tỉ lệ — port _next_delay() của ghosty-owo.
 * `currentMs` = trễ lần trước; hàm trả về trễ lần kế tiếp (đã jitter).
 */
export function nextBackoffMs(currentMs, {
  baseMs = 5000,
  factor = 2,
  maxMs = 300000,
  jitterRatio = 0.25,
} = {}) {
  const base = clampMs(baseMs, 1, Number.MAX_SAFE_INTEGER);
  const cap = clampMs(maxMs, base, Number.MAX_SAFE_INTEGER);
  const current = clampMs(currentMs || base, 1, Number.MAX_SAFE_INTEGER);

  let next = Math.min(current * (Number(factor) || 2), cap);
  const jitter = next * clampMs(jitterRatio, 0, 1);
  next += (Math.random() * 2 - 1) * jitter;
  return clampMs(next, base, cap);
}

// ── Cửa sổ hoạt động ────────────────────────────────────────

/**
 * Giới hạn giờ chạy trong khung giờ (ví dụ 08:00–23:00). Ngoài khung thì bot
 * ngủ — bot chạy cả đêm là dấu hiệu rõ nhất của một con bot, vì người thật
 * không thao tác liên tục lúc 4 giờ sáng.
 *
 * Hỗ trợ khung vắt qua nửa đêm (startHour > endHour) — ví dụ 22:00–06:00.
 */
export function createActivityWindow({
  enabled = false,
  startHour = 8,
  endHour = 23,
} = {}) {
  const on = enabled === true;
  const start = clampMs(startHour, 0, 23);
  const end = clampMs(endHour, 0, 23);

  function isOpen(now = new Date()) {
    if (!on) return true;
    const hour = now.getHours();
    if (start === end) return true;              // khung 24h
    if (start < end) return hour >= start && hour < end;
    return hour >= start || hour < end;          // vắt qua nửa đêm
  }

  /** Thời điểm khung hiện tại đóng lại (timestamp) — null nếu đang ngoài khung. */
  function closeAt(now = new Date()) {
    if (!on || !isOpen(now)) return null;
    const close = new Date(now);
    close.setHours(end, 0, 0, 0);
    if (close.getTime() <= now.getTime()) close.setDate(close.getDate() + 1);
    return close.getTime();
  }

  /** Số ms chờ tới lần mở khung kế tiếp — 0 nếu đang mở. */
  function msUntilOpen(now = new Date()) {
    if (!on || isOpen(now)) return 0;
    const open = new Date(now);
    open.setHours(start, 0, 0, 0);
    if (open.getTime() <= now.getTime()) open.setDate(open.getDate() + 1);
    return open.getTime() - now.getTime();
  }

  return {
    enabled: on,
    startHour: start,
    endHour: end,
    isOpen,
    closeAt,
    msUntilOpen,
  };
}

// ── Chu kỳ làm / nghỉ ───────────────────────────────────────

/**
 * Chu kỳ làm việc / nghỉ ngơi. Port khái niệm "work/break" + "day skip" của
 * SPEED_MODES trong ghosty-owo: làm trong N giờ, nghỉ M giờ; sau mỗi
 * `daySkipThreshold` chu kỳ làm việc thì nghỉ nguyên một ngày.
 *
 * Mục tiêu: giữ tổng lưu lượng thấp và đều, thay vì dồn toàn bộ vào một
 * khung giờ rồi im bặt — hai cách đều lộ hình dạng khác nhau.
 */
export function createWorkCycle({
  enabled = false,
  workMinMs = 3 * 3600_000,
  workMaxMs = 5 * 3600_000,
  breakMinMs = 8 * 3600_000,
  breakMaxMs = 12 * 3600_000,
  daySkipThreshold = 0,
  daySkipDurationMs = 24 * 3600_000,
} = {}) {
  const on = enabled === true;
  let mode = 'work';
  let until = 0;
  let workCycles = 0;

  function planWork(now) {
    const dur = workMinMs + Math.random() * Math.max(0, workMaxMs - workMinMs);
    mode = 'work';
    until = now + dur;
  }

  function planBreak(now) {
    workCycles += 1;
    const skip = daySkipThreshold > 0 && workCycles % daySkipThreshold === 0;
    const dur = skip
      ? daySkipDurationMs
      : breakMinMs + Math.random() * Math.max(0, breakMaxMs - breakMinMs);
    mode = 'break';
    until = now + dur;
  }

  // Lần đầu gọi: mốc chuyển phase đầu tiên được tính từ "bây giờ".
  planWork(Date.now());

  function isWorking(now = Date.now()) {
    if (!on) return true;
    if (now >= until) {
      if (mode === 'work') planBreak(now);
      else planWork(now);
    }
    return mode === 'work';
  }

  function msUntilChange(now = Date.now()) {
    if (!on) return 0;
    isWorking(now); // đồng bộ phase trước khi tính
    return Math.max(0, until - now);
  }

  /** Chờ tới lúc bắt đầu phiên làm việc kế tiếp (0 nếu đang làm). */
  function msUntilWork(now = Date.now()) {
    if (!on) return 0;
    if (isWorking(now)) return 0;
    return Math.max(0, until - now);
  }

  function reset() {
    mode = 'work';
    workCycles = 0;
    planWork(Date.now());
  }

  function snapshot(now = Date.now()) {
    isWorking(now);
    return {
      enabled: on,
      mode: on ? mode : 'work',
      until: on ? until : 0,
      workCycles,
    };
  }

  return { enabled: on, isWorking, msUntilChange, msUntilWork, reset, snapshot };
}

// ── Pacer: ngân sách lệnh theo cửa sổ ──────────────────────

/**
 * Bộ điều tiết tốc độ gửi lệnh. Hai ràng buộc chạy song song:
 *   1. tối thiểu `gapMinMs` giữa hai lệnh (có jitter → không đều như máy)
 *   2. tối đa `maxPerWindow` lệnh trong `windowMs`
 *
 * Các lời gọi acquire() được xếp hàng — hai lệnh không bao giờ được phát
 * cùng một mốc thời gian, kể cả khi chúng được yêu cầu song song.
 */
export function createPacer({
  gapMinMs = 2500,
  gapMaxMs = 4500,
  windowMs = 60000,
  maxPerWindow = 20,
} = {}) {
  const gapMin = clampMs(gapMinMs, 0, 3600000);
  const gapMax = Math.max(gapMin, clampMs(gapMaxMs, 0, 3600000));
  const window = clampMs(windowMs, 1000, 3600000);
  const budget = Math.max(1, clampMs(maxPerWindow, 1, 10000));

  const stamps = [];
  let lastAt = 0;
  let chain = Promise.resolve();

  function prune(now) {
    while (stamps.length && now - stamps[0] >= window) stamps.shift();
  }

  async function acquire() {
    // Xếp hàng: giữ khoá tới khi lệnh trước đã tính vào ngân sách.
    const previous = chain;
    let release;
    chain = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      let now = Date.now();
      prune(now);

      if (stamps.length >= budget) {
        // Hết hạn mức — chờ tới khi lệnh cũ nhất trượt khỏi cửa sổ.
        const wait = window - (now - stamps[0]) + 250;
        if (wait > 0) await sleep(wait);
        now = Date.now();
        prune(now);
      }

      const gap = gapMin === gapMax ? gapMin : randInt(gapMin, gapMax);
      const since = now - lastAt;
      if (since < gap) await sleep(gap - since);

      lastAt = Date.now();
      stamps.push(lastAt);
    } finally {
      release();
    }
  }

  function snapshot() {
    prune(Date.now());
    return {
      gapMinMs: gapMin,
      gapMaxMs: gapMax,
      windowMs: window,
      maxPerWindow: budget,
      usedInWindow: stamps.length,
      lastAt,
    };
  }

  function reset() {
    stamps.length = 0;
    lastAt = 0;
  }

  return { acquire, snapshot, reset };
}
