import { useState } from 'react';
import type { RequestsState } from '../types';

const SERIES = [
  { key: 'discord', label: 'Lệnh Discord', color: 'var(--accent)' },
  { key: 'owo', label: 'Farm OwO', color: 'var(--green)' },
  { key: 'web', label: 'Web panel', color: 'var(--yellow)' },
] as const;

const W = 760;
const H = 214;
const PAD_L = 34;
const PAD_R = 10;
const PAD_T = 16;
const PAD_B = 30;

function clockLabel(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Đường cong mượt đi qua các điểm (Catmull-Rom → Bézier). */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return points.length ? `M ${points[0].x} ${points[0].y}` : '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export function RequestChart({ data }: { data?: RequestsState }) {
  const [hover, setHover] = useState<number | null>(null);
  const buckets = (data?.buckets || []).slice(-30);
  const totals = data?.totals || { discord: 0, owo: 0, web: 0 };
  const totalAll = totals.discord + totals.owo + totals.web;

  if (!buckets.length) {
    return <div className="chart-empty">Chưa có dữ liệu yêu cầu — bot còn đang chạy, thử lại sau một lát.</div>;
  }

  const max = Math.max(1, ...buckets.map((b) => b.discord + b.owo + b.web));
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const step = buckets.length > 1 ? plotW / (buckets.length - 1) : plotW;
  const x = (i: number) => PAD_L + step * i;
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;

  // Cộng dồn theo SERIES (không phải theo thời gian): cum[i][k] = tổng
  // của k series đầu tiên tại phút i — đây là ranh giới dưới của dải k.
  const cum = buckets.map((b) => {
    const arr: number[] = [];
    let acc = 0;
    for (const s of SERIES) {
      acc += Number(b[s.key]) || 0;
      arr.push(acc);
    }
    return arr;
  });

  // Mỗi series một dải: từ đường cộng dồn trước tới đường cộng dồn sau
  const bands = SERIES.map((s, si) => {
    const top: { x: number; y: number }[] = [];
    const bottom: { x: number; y: number }[] = [];
    buckets.forEach((_, i) => {
      const lower = si === 0 ? 0 : cum[i][si - 1];
      const upper = cum[i][si];
      top.push({ x: x(i), y: y(upper) });
      bottom.push({ x: x(i), y: y(lower) });
    });
    const topPath = smoothPath(top);
    const backPath = smoothPath(bottom.slice().reverse()).replace(/^M/, 'L');
    const fill = `${topPath} ${backPath} Z`;
    return { ...s, si, topPath, fill };
  });

  const ticks = [0, Math.round(max / 2), max];
  const active = hover !== null ? buckets[hover] : null;
  const activeTotal = active ? active.discord + active.owo + active.web : 0;

  return (
    <div className="chart">
      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="chart-svg"
          role="img"
          aria-label="Biểu đồ số yêu cầu đã gửi đi theo phút"
          preserveAspectRatio="none"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const i = Math.round((px - PAD_L) / (step || 1));
            setHover(Math.min(buckets.length - 1, Math.max(0, i)));
          }}
        >
          <defs>
            {SERIES.map((s) => (
              <linearGradient id={`cg-${s.key}`} key={s.key} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.42" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0.05" />
              </linearGradient>
            ))}
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={PAD_L - 6} y={y(t) + 3.5} className="chart-axis" textAnchor="end">
                {t}
              </text>
            </g>
          ))}

          {bands.map((b) => (
            <path key={b.key} d={b.fill} fill={`url(#cg-${b.key})`} className="chart-area" />
          ))}
          {bands.map((b) => (
            <path
              key={`${b.key}-line`}
              d={b.topPath}
              fill="none"
              stroke={b.color}
              strokeWidth={1.6}
              strokeLinecap="round"
              className="chart-line"
            />
          ))}

          {hover !== null ? (
            <g className="chart-cursor">
              <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + plotH} className="chart-guide" />
              {SERIES.map((s, si) => (
                <circle
                  key={s.key}
                  cx={x(hover)}
                  cy={y(cum[hover][si])}
                  r={3.4}
                  fill={s.color}
                  className="chart-dot"
                  style={{ animationDelay: `${si * 60}ms` }}
                />
              ))}
            </g>
          ) : null}

          <text x={PAD_L} y={H - 8} className="chart-axis">
            {clockLabel(buckets[0].t)}
          </text>
          <text x={W / 2} y={H - 8} className="chart-axis" textAnchor="middle">
            {clockLabel(buckets[Math.floor(buckets.length / 2)].t)}
          </text>
          <text x={W - PAD_R} y={H - 8} className="chart-axis" textAnchor="end">
            {clockLabel(buckets[buckets.length - 1].t)}
          </text>
        </svg>

        {active ? (
          <div
            className="chart-tip"
            style={{ left: `${((x(hover as number) / W) * 100).toFixed(2)}%` }}
          >
            <b>{clockLabel(active.t)}</b>
            {SERIES.map((s) => (
              <span key={s.key}>
                <i className={`lg-dot chart-${s.key}`} aria-hidden="true" />
                {s.label}
                <i className="tip-n">{active[s.key] || 0}</i>
              </span>
            ))}
            <span className="tip-total">
              Tổng
              <i className="tip-n">{activeTotal}</i>
            </span>
          </div>
        ) : null}
      </div>

      <div className="chart-legend">
        {SERIES.map((s) => (
          <span className="lg" key={s.key}>
            <i className={`lg-dot chart-${s.key}`} aria-hidden="true" />
            {s.label}
            <b>{totals[s.key] || 0}</b>
          </span>
        ))}
        <span className="lg total">
          Tổng 30 phút<b>{totalAll}</b>
        </span>
      </div>
    </div>
  );
}
