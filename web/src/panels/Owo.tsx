import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useApp } from '../context';
import { useAction } from '../hooks/useAction';
import { fmtDur } from '../lib/format';
import { Badge, Card, Empty, Field, KV, Msg, Toggle } from '../components/ui';
import type { OwoCounters, OwoFeature, OwoSafeRange, OwoState } from '../types';

type ModKey = 'hunt' | 'quest' | 'gem' | 'train' | 'roll' | 'daily';

interface ModuleForm {
  enabled: boolean;
  minSec: string;
  maxSec: string;
}

interface OwoForm {
  channels: string;
  boss: boolean;
  modules: Record<ModKey, ModuleForm>;
}

const MIN_SEC = 15;
const MAX_SEC = 3 * 60 * 60;

const MODULES: { key: ModKey; title: string; hint: string; def: ModuleForm }[] = [
  {
    key: 'hunt',
    title: 'Auto hunt — gửi owo h',
    hint: 'xoay vòng qua các channel đã khai báo',
    def: { enabled: true, minSec: '20', maxSec: '45' },
  },
  {
    key: 'quest',
    title: 'Auto quest — gửi owo q',
    hint: 'đọc quest log, claim thưởng, tự làm quest',
    def: { enabled: true, minSec: '300', maxSec: '600' },
  },
  {
    key: 'gem',
    title: 'Auto gem — xem inventory rồi dùng gem mạnh nhất',
    hint: '',
    def: { enabled: false, minSec: '1800', maxSec: '3600' },
  },
  {
    key: 'train',
    title: 'Auto train — gửi owo train',
    hint: 'lên cấp pet',
    def: { enabled: false, minSec: '600', maxSec: '900' },
  },
  {
    key: 'roll',
    title: 'Auto roll — gửi owo roll',
    hint: 'farm cowoncy',
    def: { enabled: false, minSec: '300', maxSec: '600' },
  },
  {
    key: 'daily',
    title: 'Auto daily — gửi owo daily',
    hint: 'claim thưởng hằng ngày',
    def: { enabled: false, minSec: '3600', maxSec: '7200' },
  },
];

const COUNTERS: [keyof OwoCounters & string, string][] = [
  ['commands', 'Lệnh đã gửi'],
  ['hunts', 'Lần hunt'],
  ['quests', 'Lần quest'],
  ['gemChecks', 'Lần xem gem'],
  ['gemsUsed', 'Gem đã dùng'],
  ['bossClicks', 'Lần đánh boss'],
  ['trains', 'Lần train'],
  ['rolls', 'Lần roll'],
  ['dailies', 'Lần daily'],
  ['catches', 'Bắt được'],
  ['questsDone', 'Quest xong'],
  ['claims', 'Claim thưởng'],
  ['questActions', 'Hành động quest'],
  ['captchaStops', 'Dừng vì captcha'],
  ['warnings', 'Cảnh báo'],
];

const EVENT_TONE: Record<string, 'good' | 'bad' | 'accent' | 'warn' | ''> = {
  start: 'good',
  stop: '',
  pause: 'bad',
  gem: 'accent',
  boss: 'warn',
};

function clampSec(value: string, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_SEC, Math.max(MIN_SEC, n));
}

function featureForm(f: OwoFeature | undefined, def: ModuleForm): ModuleForm {
  if (!f) return { ...def };
  const rawMin = Math.round((f.minMs || f.intervalMs || 0) / 1000);
  const rawMax = Math.round((f.maxMs || f.intervalMs || rawMin * 1000) / 1000);
  const min = rawMin || Number(def.minSec);
  const max = rawMax || Number(def.maxSec);
  return {
    enabled: !!f.enabled,
    minSec: String(Math.max(MIN_SEC, min)),
    maxSec: String(Math.max(MIN_SEC, max)),
  };
}

function formFrom(owo: OwoState): OwoForm {
  const modules = {} as Record<ModKey, ModuleForm>;
  for (const m of MODULES) {
    modules[m.key] = featureForm(owo.features?.[m.key], m.def);
  }
  return {
    channels: (owo.channels || []).join(', '),
    boss: !!owo.features?.boss?.enabled,
    modules,
  };
}

function payloadFrom(form: OwoForm) {
  const out: Record<string, unknown> = {
    channels: form.channels.split(/[\s,;]+/).filter(Boolean),
    boss: { enabled: form.boss },
  };
  for (const m of MODULES) {
    const f = form.modules[m.key];
    const min = clampSec(f.minSec, Number(m.def.minSec));
    const max = Math.max(min, clampSec(f.maxSec, min));
    out[m.key] = { enabled: f.enabled, minMs: min * 1000, maxMs: max * 1000 };
  }
  return out;
}

function pauseLabel(paused?: string): string {
  if (paused === 'captcha') return 'captcha';
  if (paused === 'warning') return 'cảnh báo';
  if (paused === 'offline') return 'mất kết nối';
  return paused || '';
}

export function OwoPanel() {
  const { status, acctId, refresh } = useApp();
  const formAct = useAction();
  const questAct = useAction();
  const [form, setForm] = useState<OwoForm>(() => ({
    channels: '',
    boss: false,
    modules: MODULES.reduce((acc, m) => {
      acc[m.key] = { ...m.def };
      return acc;
    }, {} as Record<ModKey, ModuleForm>),
  }));
  const [safe, setSafe] = useState<Record<string, OwoSafeRange>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState('');

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setLoadErr('');
    void (async () => {
      const res = await apiGet<{ ok: boolean; owo?: OwoState; error?: string }>('/api/owo');
      if (!alive) return;
      if (res.ok && res.owo) {
        setForm(formFrom(res.owo));
        setSafe(res.owo.safe || {});
      } else {
        setLoadErr(res.error || 'Không tải được cài đặt OwO');
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [acctId]);

  const owo = status?.owo || null;

  const setModule = (key: ModKey, patch: Partial<ModuleForm>) =>
    setForm((prev) => ({
      ...prev,
      modules: { ...prev.modules, [key]: { ...prev.modules[key], ...patch } },
    }));

  const useSafe = (key: ModKey) => {
    const s = safe[key];
    if (!s) return;
    setModule(key, {
      minSec: String(Math.round(s.minMs / 1000)),
      maxSec: String(Math.round(s.maxMs / 1000)),
    });
  };

  const useSafeAll = () => {
    for (const m of MODULES) useSafe(m.key);
  };

  const requireLoaded = (): boolean => {
    if (loaded) return true;
    formAct.setMsg({ kind: 'err', text: 'Lỗi: Đang tải cài đặt — thử lại sau 1 giây' });
    return false;
  };

  const save = async () => {
    if (!requireLoaded()) return;
    const res = await formAct.run(() => apiPost('/api/owo', { action: 'save', ...payloadFrom(form) }));
    if (res.ok) await refresh();
  };

  const start = async () => {
    if (!requireLoaded()) return;
    const res = await formAct.run(async () => {
      const saved = await apiPost('/api/owo', { action: 'save', ...payloadFrom(form) });
      if (!saved.ok) return saved;
      return apiPost('/api/owo', { action: 'start' });
    });
    if (res.ok) await refresh();
  };

  const paused = owo?.paused || '';
  const stateText = owo ? (owo.enabled ? 'ĐANG CHẠY' : paused ? `TẠM DỪNG (${pauseLabel(paused)})` : 'TẮT') : '—';
  const stateTone = owo ? (owo.enabled ? 'good' : paused ? 'bad' : '') : '';
  const counters: OwoCounters = owo?.counters || {};
  const quests = owo?.quests || [];
  const peers = owo?.peerNames || [];
  const untilMs = Number(owo?.questsUntil) || 0;
  const untilText =
    untilMs > Date.now() ? 'quest mới sau ' + fmtDur((untilMs - Date.now()) / 1000) : 'chờ quest mới';
  const cap = owo?.captcha || {};
  const capUrl = /^https?:\/\//i.test(String(cap.url || '')) ? String(cap.url) : '';
  const capRemain = Math.ceil((Number(cap.cooldownRemainingMs) || 0) / 1000);
  const lastPause = (owo?.events || []).filter((e) => e.kind === 'pause').pop();
  const events = (owo?.events || []).slice(-8).reverse();

  const nextText = (f?: OwoFeature): string => {
    if (!f?.enabled) return '—';
    const min = Math.round((f.minMs || 0) / 1000);
    const max = Math.round((f.maxMs || 0) / 1000);
    const range = max > min ? `${min}s–${max}s` : `${min}s`;
    if (!f.nextAt) return range;
    const remain = f.nextAt - Date.now();
    if (remain <= 0) return `${range} (đang tới)`;
    return `${range} · sau ${fmtDur(remain / 1000)}`;
  };

  return (
    <div className="panel">
      <div className="grid two">
        <Card
          title="Farm OwO"
          hint={owo ? (owo.enabled ? 'farm đang chạy' : paused ? 'khoá vì ' + pauseLabel(paused) : 'đang tắt') : '—'}
          i={0}
        >
          <KV k="Trạng thái" v={stateText} tone={stateTone} />
          <KV k="Dừng vì" v={paused ? lastPause?.text || pauseLabel(paused) : '—'} tone={paused ? 'bad' : ''} />
          <KV k="Channel farm" v={(owo?.channels || []).length ? (owo?.channels || []).join(', ') : '— (chưa khai báo)'} />
          <KV k="Lệnh gần nhất" v={owo?.lastSentAt ? fmtDur((Date.now() - owo.lastSentAt) / 1000) + ' trước' : '—'} />
          <KV k="Lỗi cuối" v={owo?.lastError || '—'} tone={owo?.lastError ? 'bad' : ''} />

          {paused === 'captcha' ? (
            <div className="notice bad">
              <div>
                <span className="n-title">OwO yêu cầu captcha</span>
                <span className="n-text">
                  Giải tay trong server rồi bấm "Bật farm"
                  {capRemain > 0 ? ` — hạ nghỉ còn ${fmtDur(capRemain)}` : ''}.
                </span>
              </div>
              {capUrl ? (
                <a className="n-link" href={capUrl} target="_blank" rel="noreferrer">
                  Mở ảnh captcha
                </a>
              ) : null}
            </div>
          ) : null}

          <div style={{ marginTop: 12 }}>
            <Field label="Channel farm (ID hoặc link Discord, cách nhau bằng dấu phẩy)">
              <input
                type="text"
                value={form.channels}
                placeholder="123456789012345678 hoặc https://discord.com/channels/..."
                onChange={(e) => setForm((p) => ({ ...p, channels: e.target.value }))}
              />
            </Field>
          </div>
          <div className="row">
            <button className="primary" disabled={formAct.busy || !loaded} onClick={() => void start()}>
              Bật farm
            </button>
            <button
              className="danger"
              disabled={formAct.busy}
              onClick={() => void formAct.run(() => apiPost('/api/owo', { action: 'stop' }))}
            >
              Tắt
            </button>
            <button disabled={formAct.busy || !loaded} onClick={() => void save()}>
              Lưu cài đặt
            </button>
          </div>
          {loadErr ? <Msg state={{ kind: 'err', text: loadErr }} /> : null}
          <Msg state={formAct.msg} />
        </Card>

        <Card
          title="Module & khoảng thời gian"
          hint={<button className="small" type="button" disabled={!loaded} onClick={useSafeAll}>Time an toàn</button>}
          i={1}
        >
          {MODULES.map((m) => {
            const f = form.modules[m.key];
            const live = owo?.features?.[m.key];
            return (
              <div className="mod-row" key={m.key}>
                <Toggle checked={f.enabled} onChange={(v) => setModule(m.key, { enabled: v })}>
                  {m.title}
                  {m.hint ? <span className="sub"> — {m.hint}</span> : null}
                </Toggle>
                <div className="mod-times">
                  <input
                    type="number"
                    min={MIN_SEC}
                    max={MAX_SEC}
                    step={1}
                    value={f.minSec}
                    aria-label={`${m.key} — thời gian ngắn nhất (giây)`}
                    onChange={(e) => setModule(m.key, { minSec: e.target.value })}
                  />
                  <span className="dash">→</span>
                  <input
                    type="number"
                    min={MIN_SEC}
                    max={MAX_SEC}
                    step={1}
                    value={f.maxSec}
                    aria-label={`${m.key} — thời gian lâu nhất (giây)`}
                    onChange={(e) => setModule(m.key, { maxSec: e.target.value })}
                  />
                  <button className="small ghost" type="button" onClick={() => useSafe(m.key)}>
                    An toàn
                  </button>
                  <span className="mod-next">{nextText(live)}</span>
                </div>
              </div>
            );
          })}

          <Toggle checked={form.boss} onChange={(v) => setForm((p) => ({ ...p, boss: v }))}>
            Auto boss — bấm nút Fight khi boss hiện
          </Toggle>
        </Card>
      </div>

      <div className="grid two">
        <Card title="Số liệu" i={2}>
          <div className="stats-grid">
            {COUNTERS.map(([key, label]) => (
              <div className="kv" key={key}>
                <span className="k">{label}</span>
                <span className="v">{String(counters[key] ?? 0)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Gần đây" i={3}>
          <div className="list">
            {events.length ? (
              events.map((ev, idx) => (
                <div className="item" key={`${ev.at}-${idx}`}>
                  <div className="left">
                    <div className="who">{ev.text}</div>
                  </div>
                  <div className="right">
                    <Badge tone={EVENT_TONE[ev.kind] ?? ''}>
                      {new Date(ev.at).toLocaleTimeString('vi-VN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <Empty>Chưa có hoạt động nào</Empty>
            )}
          </div>
        </Card>
      </div>

      <Card
        title="Quest log"
        hint={
          owo
            ? owo.questsAllDone
              ? 'xong hết · ' + untilText
              : quests.length
                ? `${quests.length} quest · ${peers.length ? 'acc phụ: ' + peers.join(', ') : 'chưa có acc phụ'}`
                : 'chưa đọc'
            : '—'
        }
        i={4}
      >
        <div className="row" style={{ marginBottom: 10 }}>
          <button
            className="small"
            disabled={questAct.busy}
            onClick={() => void questAct.run(() => apiPost('/api/owo', { action: 'quest-refetch' }))}
          >
            Đọc quest log
          </button>
          <button
            className="small"
            disabled={questAct.busy}
            onClick={() => void questAct.run(() => apiPost('/api/owo', { action: 'quest-run' }))}
          >
            Làm quest ngay
          </button>
          <span className="meta">
            {owo?.questsAllDone ? untilText : owo ? (owo.peers ? `${owo.peers} acc phụ` : 'chưa có acc phụ') : ''}
          </span>
        </div>

        <div className="list">
          {quests.length ? (
            quests.map((q) => {
              const total = Math.max(1, Number(q.total) || 0);
              const cur = Math.max(0, Math.min(total, Number(q.current) || 0));
              const done = cur >= total;
              const wait = done ? 0 : Number(q.readyInMs) || 0;
              return (
                <div className="item quest-row" key={q.key}>
                  <div className="left">
                    <div>
                      <div className="who">{q.label || q.key}</div>
                      {wait > 1000 ? <div className="sub wait">chờ {fmtDur(wait / 1000)}</div> : null}
                    </div>
                  </div>
                  <div className="right">
                    <div className="qbar">
                      <i
                        className={done ? 'done' : undefined}
                        style={{ width: Math.round((cur / total) * 100) + '%' }}
                      />
                    </div>
                    <Badge tone={done ? 'good' : ''}>
                      {cur}/{total}
                    </Badge>
                  </div>
                </div>
              );
            })
          ) : (
            <Empty>
              {owo?.questsAllDone
                ? 'Đã xong hết quest — ' + untilText
                : 'Chưa đọc quest log — bấm "Đọc quest log" hoặc bật farm'}
            </Empty>
          )}
        </div>
        <Msg state={questAct.msg} />
      </Card>
    </div>
  );
}
