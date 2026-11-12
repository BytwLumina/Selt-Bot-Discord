export function fmtDur(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${r}s`;
  return `${r}s`;
}

export function fmtClock(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function fmtDateTime(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('vi-VN');
}

// Đọc mốc thời gian cho RPC: "now", "now+2h", "in 30m", ISO, unix
export function parseTs(value: string): number | null {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'now') return Date.now();

  const dur = (rest: string): number => {
    let total = 0;
    let m: RegExpExecArray | null;
    const re = /(\d+)\s*(d|h|m|s)/g;
    while ((m = re.exec(rest))) {
      const n = Number(m[1]);
      if (m[2] === 'd') total += n * 86400;
      else if (m[2] === 'h') total += n * 3600;
      else if (m[2] === 'm') total += n * 60;
      else total += n;
    }
    return total;
  };

  const rel = s.match(/^now\s*([+-])\s*(.+)$/);
  if (rel) return Date.now() + (rel[1] === '-' ? -1 : 1) * dur(rel[2]) * 1000;

  const inFut = s.match(/^in\s+(.+)$/);
  if (inFut) return Date.now() + dur(inFut[1]) * 1000;

  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;

  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return n > 1e12 ? n : n * 1000;
  return null;
}
