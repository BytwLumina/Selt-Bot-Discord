import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useApp } from '../context';
import { useAction } from '../hooks/useAction';
import { fmtDateTime, parseTs } from '../lib/format';
import { Card, Field, Msg, Toggle } from '../components/ui';
import type { RpcConfig, RpcState } from '../types';

interface RpcFormState {
  application_name: string;
  type: string;
  status: string;
  details: string;
  state: string;
  stream_url: string;
  timestamp_mode: string;
  start_timestamp: string;
  end_timestamp: string;
  party_current: string;
  party_max: string;
  party_id: string;
  button1_label: string;
  button1_url: string;
  button2_label: string;
  button2_url: string;
  large_image: string;
  large_text: string;
  small_image: string;
  small_text: string;
  refreshInterval: string;
}

type FieldKey = keyof RpcFormState;

interface FieldDef {
  key: FieldKey;
  label: string;
  placeholder?: string;
  maxLength?: number;
  inputType?: 'text' | 'number';
  min?: number;
  max?: number;
  options?: string[];
}

const EMPTY: RpcFormState = {
  application_name: '',
  type: 'PLAYING',
  status: 'online',
  details: '',
  state: '',
  stream_url: '',
  timestamp_mode: 'start',
  start_timestamp: '',
  end_timestamp: '',
  party_current: '',
  party_max: '',
  party_id: '',
  button1_label: '',
  button1_url: '',
  button2_label: '',
  button2_url: '',
  large_image: '',
  large_text: '',
  small_image: '',
  small_text: '',
  refreshInterval: '',
};

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Ứng dụng',
    fields: [
      {
        key: 'application_name',
        label: 'Tên hiển thị (application_name)',
        placeholder: 'Đang xem Discord',
        maxLength: 128,
      },
      {
        key: 'type',
        label: 'Loại',
        options: ['PLAYING', 'STREAMING', 'LISTENING', 'WATCHING', 'COMPETING', 'CUSTOM'],
      },
      { key: 'status', label: 'Trạng thái', options: ['online', 'idle', 'dnd', 'invisible'] },
    ],
  },
  {
    title: 'Nội dung',
    fields: [
      {
        key: 'details',
        label: 'Dòng phụ (details)',
        placeholder: 'Có thể dùng {user} {ping} {uptime}',
        maxLength: 128,
      },
      {
        key: 'state',
        label: 'Dòng phụ 2 (state)',
        placeholder: 'Có thể dùng {guilds} {date} {clock}',
        maxLength: 128,
      },
      { key: 'stream_url', label: 'Stream URL (khi type = STREAMING)', placeholder: 'https://...' },
    ],
  },
  {
    title: 'Thời gian',
    fields: [
      {
        key: 'timestamp_mode',
        label: 'Chế độ timestamp',
        options: ['start', 'end', 'both'],
      },
      {
        key: 'start_timestamp',
        label: 'Bắt đầu',
        placeholder: 'now / now+30m / 2026-01-01T10:00:00Z',
      },
      {
        key: 'end_timestamp',
        label: 'Kết thúc',
        placeholder: 'now+2h / 2026-01-01T12:00:00Z',
      },
    ],
  },
  {
    title: 'Party',
    fields: [
      { key: 'party_current', label: 'Party hiện tại', inputType: 'number', min: 0, max: 999 },
      { key: 'party_max', label: 'Party tối đa', inputType: 'number', min: 0, max: 999 },
      { key: 'party_id', label: 'Party ID', maxLength: 128 },
    ],
  },
  {
    title: 'Nút bấm',
    fields: [
      { key: 'button1_label', label: 'Button 1 — nhãn', maxLength: 32 },
      { key: 'button1_url', label: 'Button 1 — URL', placeholder: 'https://...' },
      { key: 'button2_label', label: 'Button 2 — nhãn', maxLength: 32 },
      { key: 'button2_url', label: 'Button 2 — URL', placeholder: 'https://...' },
    ],
  },
  {
    title: 'Hình ảnh',
    fields: [
      { key: 'large_image', label: 'Ảnh lớn (large_image)', placeholder: 'mp: tên asset / URL' },
      { key: 'large_text', label: 'Chữ ảnh lớn', maxLength: 128 },
      { key: 'small_image', label: 'Ảnh nhỏ (small_image)', placeholder: 'mp: tên asset / URL' },
      { key: 'small_text', label: 'Chữ ảnh nhỏ', maxLength: 128 },
    ],
  },
  {
    title: 'Khác',
    fields: [
      {
        key: 'refreshInterval',
        label: 'Refresh (giây)',
        inputType: 'number',
        min: 0,
        max: 3600,
        placeholder: '60',
      },
    ],
  },
];

const NUM_KEYS = new Set<FieldKey>(['party_current', 'party_max', 'refreshInterval']);

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function formFrom(config: RpcConfig): RpcFormState {
  const next = { ...EMPTY };
  for (const key of Object.keys(next) as FieldKey[]) {
    next[key] = text(config[key]);
  }
  if (!next.type) next.type = 'PLAYING';
  if (!next.status) next.status = 'online';
  if (!next.timestamp_mode) next.timestamp_mode = 'start';
  return next;
}

interface RpcChecks {
  enabled: boolean;
  hotReload: boolean;
  applyOnReady: boolean;
  templates: boolean;
}

function checksFrom(config: RpcConfig): RpcChecks {
  return {
    enabled: config.enabled !== false,
    hotReload: config.hotReload === true,
    applyOnReady: config.applyOnReady === true,
    templates: config.templates === true,
  };
}

export function RpcPanel() {
  const { status, acctId, refresh } = useApp();
  const act = useAction();
  const [form, setForm] = useState<RpcFormState>(EMPTY);
  const [checks, setChecks] = useState<RpcChecks>({
    enabled: true,
    hotReload: true,
    applyOnReady: true,
    templates: true,
  });
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiGet<{ ok: boolean; config?: RpcConfig; error?: string }>('/api/rpc/config');
    if (res.ok && res.config) {
      setForm(formFrom(res.config));
      setChecks(checksFrom(res.config));
      setLoadErr('');
    } else {
      setLoadErr(res.error || 'Không tải được cấu hình RPC');
    }
    setLoading(false);
    return res;
  }, []);

  useEffect(() => {
    void load();
  }, [load, acctId]);

  const set = (key: FieldKey, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const buildPatch = (): Record<string, unknown> => {
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(form) as FieldKey[]) {
      const value = form[key].trim();
      if (!value) continue;
      if (NUM_KEYS.has(key)) {
        const n = Number(value);
        if (Number.isFinite(n)) patch[key] = n;
      } else {
        patch[key] = value;
      }
    }
    patch.enabled = checks.enabled;
    patch.hotReload = checks.hotReload;
    patch.applyOnReady = checks.applyOnReady;
    patch.templates = checks.templates;
    return patch;
  };

  const save = async () => {
    const res = await act.run(() => apiPost('/api/rpc/save', { patch: buildPatch() }));
    if (res.ok) {
      await load();
      await refresh();
    }
  };

  const reload = async () => {
    const res = await act.run(() => apiPost('/api/rpc/reload'));
    if (res.ok) {
      await load();
      await refresh();
    }
  };

  const off = async () => {
    await act.run(() => apiPost('/api/rpc/off'));
    await refresh();
  };

  const startTs = parseTs(form.start_timestamp);
  const endTs = parseTs(form.end_timestamp);
  const timeParts: string[] = [];
  if ((form.timestamp_mode === 'start' || form.timestamp_mode === 'both') && startTs) {
    timeParts.push('Bắt đầu ' + fmtDateTime(startTs));
  }
  if ((form.timestamp_mode === 'end' || form.timestamp_mode === 'both') && endTs) {
    timeParts.push('Kết thúc ' + fmtDateTime(endTs));
  }
  const partyCur = Number(form.party_current);
  const partyMax = Number(form.party_max);
  const buttons = [form.button1_label.trim(), form.button2_label.trim()].filter(Boolean);
  const rpc: RpcState = status?.rpc || {};

  return (
    <div className="panel">
      <div className="grid rpc-grid">
        <Card
          title="Cấu hình RPC"
          hint={loading ? 'đang tải…' : rpc.enabled ? (rpc.applied ? 'đang áp dụng' : 'chưa áp dụng') : 'tắt'}
          i={0}
        >
          <div className="row" style={{ marginBottom: 12 }}>
            <button className="primary" disabled={act.busy || loading} onClick={() => void save()}>
              Lưu &amp; áp dụng
            </button>
            <button disabled={act.busy || loading} onClick={() => void reload()}>
              Reload từ file
            </button>
            <button className="danger" disabled={act.busy} onClick={() => void off()}>
              Tắt RPC
            </button>
          </div>

          {SECTIONS.map((section) => (
            <div className="form-sec" key={section.title}>
              <h3>{section.title}</h3>
              <div className="fields">
                {section.fields.map((f) =>
                  f.options ? (
                    <Field key={f.key} label={f.label}>
                      <select
                        value={form[f.key]}
                        disabled={loading}
                        onChange={(e) => set(f.key, e.target.value)}
                      >
                        {f.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : (
                    <Field key={f.key} label={f.label}>
                      <input
                        type={f.inputType || 'text'}
                        value={form[f.key]}
                        placeholder={f.placeholder}
                        maxLength={f.maxLength}
                        min={f.min}
                        max={f.max}
                        disabled={loading}
                        onChange={(e) => set(f.key, e.target.value)}
                      />
                    </Field>
                  ),
                )}
              </div>
            </div>
          ))}

          <div className="form-sec">
            <h3>Tuỳ chọn</h3>
            <Toggle checked={checks.enabled} onChange={(v) => setChecks((c) => ({ ...c, enabled: v }))} disabled={loading}>
              Bật RPC
            </Toggle>
            <Toggle checked={checks.hotReload} onChange={(v) => setChecks((c) => ({ ...c, hotReload: v }))} disabled={loading}>
              Tự reload khi sửa rpc.json
            </Toggle>
            <Toggle
              checked={checks.applyOnReady}
              onChange={(v) => setChecks((c) => ({ ...c, applyOnReady: v }))}
              disabled={loading}
            >
              Áp dụng ngay khi bot khởi động
            </Toggle>
            <Toggle checked={checks.templates} onChange={(v) => setChecks((c) => ({ ...c, templates: v }))} disabled={loading}>
              Cho phép biến {'{user} {ping} {uptime} {guilds} {date} {clock}'}
            </Toggle>
          </div>

          {loadErr ? <Msg state={{ kind: 'err', text: loadErr }} /> : null}
          <Msg state={act.msg} />
        </Card>

        <div className="stack">
          <Card title="Xem trước" i={1}>
            <div className="preview">
              <div className="p-head">
                <img className="avatar" src="/assets/logo.jpg" alt="" />
                <div>
                  <div className="p-name">{status?.user?.tag || 'Bot'}</div>
                  <div className="p-type">
                    {form.type || 'PLAYING'} · {form.status || 'online'}
                  </div>
                </div>
              </div>
              <div className="p-title">{form.application_name || '(chưa đặt tên)'}</div>
              {form.details ? <div className="p-line">{form.details}</div> : null}
              {form.state ? <div className="p-line">{form.state}</div> : null}
              {partyCur > 0 && partyMax > 0 ? (
                <div className="p-line">
                  Party — {partyCur} / {partyMax}
                </div>
              ) : null}
              {buttons.length ? (
                <div className="p-btns">
                  {buttons.map((b, i) => (
                    <span className="p-btn" key={`${b}-${i}`}>
                      {b}
                    </span>
                  ))}
                </div>
              ) : null}
              {timeParts.length ? <div className="p-time">{timeParts.join('  ·  ')}</div> : null}
            </div>
          </Card>

          <Card title="Gợi ý biến" i={2}>
            <div className="kv">
              <span className="k">Tài khoản</span>
              <span className="v">{'{user} {tag} {id}'}</span>
            </div>
            <div className="kv">
              <span className="k">Trạng thái bot</span>
              <span className="v">{'{ping} {guilds} {uptime} {status}'}</span>
            </div>
            <div className="kv">
              <span className="k">Thời gian</span>
              <span className="v">{'{clock} {date}'}</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
