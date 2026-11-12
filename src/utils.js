import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function sleep(ms) {
  const n = Math.max(0, ms | 0);
  if (n === 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, n));
}

export function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    if (timer.unref) timer.unref();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export function randInt(min, max) {
  const a = Math.ceil(Math.min(min, max));
  const b = Math.floor(Math.max(min, max));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return a || 0;
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

export function pickRandom(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function readLines(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

export function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}

export function shorten(s, n = 60) {
  s = String(s ?? '');
  if (s.length <= n) return s;
  if (n <= 1) return s.slice(0, n);
  return s.slice(0, n - 1) + '…';
}

export function redactSecret(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/([A-Za-z0-9_-]{20,})\.([A-Za-z0-9_-]{5,})\.([A-Za-z0-9_-]{20,})/g, '$1.***.***')
    .replace(/(Authorization["'\s:]+)["']?[\w.\-]+["']?/gi, '$1***')
    .replace(/(token["'\s:=]+)["']?[\w.\-]+["']?/gi, '$1***');
}

export function sha12(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 12);
}

/**
 * Đọc tham chiếu kênh từ link Discord, cặp guild/channel hoặc ID trần.
 * Trả về { guildId, channelId } (guildId = null với link @me) hoặc null.
 */
export function parseChannelRef(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;

  const link = text.match(/discord(?:app)?\.com\/channels\/(@me|\d{15,22})\/(\d{15,22})/i);
  if (link) {
    return { guildId: link[1].toLowerCase() === '@me' ? null : link[1], channelId: link[2] };
  }

  const pair = text.match(/^(\d{15,22})\s*[/:,\s]\s*(\d{15,22})$/);
  if (pair) return { guildId: pair[1], channelId: pair[2] };

  if (/^\d{15,22}$/.test(text)) return { guildId: null, channelId: text };
  return null;
}

/** Lấy mọi channel ID trong một chuỗi (ID trần hoặc link), bỏ trùng, giữ thứ tự. */
export function extractChannelIds(input) {
  const text = String(input ?? '');
  const linkRe = /discord(?:app)?\.com\/channels\/(?:@me|\d{15,22})\/(\d{15,22})/gi;
  const ranges = [];
  const hits = [];

  for (const m of text.matchAll(linkRe)) {
    hits.push({ at: m.index, id: m[1] });
    ranges.push([m.index, m.index + m[0].length]);
  }

  const insideLink = (at) => ranges.some(([a, b]) => at >= a && at < b);
  for (const m of text.matchAll(/\d{15,22}/g)) {
    if (!insideLink(m.index)) hits.push({ at: m.index, id: m[0] });
  }

  hits.sort((a, b) => a.at - b.at);

  const out = [];
  const seen = new Set();
  for (const h of hits) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    out.push(h.id);
  }
  return out;
}

export function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? `${h}h${mm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d}d${hh}h` : `${d}d`;
}

export function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function auditSecretFile(file, label) {
  try {
    if (!fs.existsSync(file)) return;
    if (process.platform === 'win32') return;
    const st = fs.statSync(file);
    const mode = st.mode & 0o777;
    if (mode & 0o077) {
      process.stderr.write(
        `[warn] ${label} (${file}) có permission ${mode.toString(8)} — nên set 0600\n`
      );
    }
  } catch {}
}

// ── Typing delay theo độ dài tin ─────────────────────────
// Tin ngắn → delay ngắn, tin dài → delay dài, cộng jitter
export function computeTypingDelay(text, config) {
  const td = config?.typingDelay || {};

  const baseMin = td.baseMinMs ?? 500;
  const baseMax = td.baseMaxMs ?? 1200;
  const perChar = td.perCharMs ?? 15;
  const maxMs = td.maxMs ?? 3500;
  const jMin = td.jitterMinMs ?? 0;
  const jMax = td.jitterMaxMs ?? 800;

  const body = String(text ?? '');
  const len = body.length;

  // Random base trong [min, max]
  const base = Math.floor(Math.random() * (baseMax - baseMin + 1)) + baseMin;

  // Cộng theo độ dài, cap ở maxMs
  const extra = Math.min(len * perChar, maxMs);

  // Jitter thêm
  const jitter = Math.floor(Math.random() * (jMax - jMin + 1)) + jMin;

  return base + extra + jitter;
}