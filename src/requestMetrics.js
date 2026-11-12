// Bộ đếm yêu cầu theo phút — phục vụ biểu đồ ở web panel.
// Ba loại: lệnh bot gửi Discord, lệnh farm OwO, request API của web panel.
const KINDS = ['discord', 'owo', 'web'];
const MAX_BUCKETS = 240; // giữ khoảng 4 giờ

const buckets = new Map();

function minuteKey(ts = Date.now()) {
  return Math.floor(ts / 60000) * 60000;
}

export function bumpRequest(kind, delta = 1) {
  if (!KINDS.includes(kind)) return;
  const key = minuteKey();
  const cur = buckets.get(key) || { t: key, discord: 0, owo: 0, web: 0 };
  cur[kind] += delta;
  buckets.set(key, cur);

  if (buckets.size > MAX_BUCKETS) {
    const keys = [...buckets.keys()].sort((a, b) => a - b);
    for (const k of keys.slice(0, keys.length - MAX_BUCKETS)) buckets.delete(k);
  }
}

export function requestSnapshot(minutes = 30) {
  const now = Date.now();
  const last = minuteKey(now);
  const start = last - (Math.max(1, minutes) - 1) * 60000;
  const totals = { discord: 0, owo: 0, web: 0 };
  const out = [];

  for (let t = start; t <= last; t += 60000) {
    const b = buckets.get(t) || { t, discord: 0, owo: 0, web: 0 };
    out.push({ t, discord: b.discord, owo: b.owo, web: b.web });
    totals.discord += b.discord;
    totals.owo += b.owo;
    totals.web += b.web;
  }

  return { buckets: out, totals, kinds: KINDS };
}
