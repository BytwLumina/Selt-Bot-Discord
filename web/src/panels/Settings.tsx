import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useApp } from '../context';
import { useAction } from '../hooks/useAction';
import { Badge, Card, Field, KV, Msg, Toggle } from '../components/ui';
import type { ConfigState, ConfigStream } from '../types';

interface Form {
  width: string;
  height: string;
  fps: string;
  bitrateKbps: string;
  preset: string;
  captureSource: string;
  cameraDevice: string;
  captureCursor: boolean;
  autoRestart: boolean;
  autoRestartMax: string;
  autoRestartDelaySec: string;
}

const EMPTY: Form = {
  width: '640',
  height: '360',
  fps: '15',
  bitrateKbps: '1200',
  preset: 'faster',
  captureSource: 'black',
  cameraDevice: '',
  captureCursor: true,
  autoRestart: true,
  autoRestartMax: '5',
  autoRestartDelaySec: '10',
};

// Nguồn hình chỉ có "hình đen" — camera bấm nút "Mở cam" ở tab Voice & Stream.
const SOURCE_LABEL: Record<string, string> = {
  black: 'Hình đen',
  camera: 'Camera máy',
  screen: 'Màn hình máy',
};

const PRESETS: { label: string; w: number; h: number; fps: number; kbps: number }[] = [
  { label: 'Nhẹ — 320×180 @10', w: 320, h: 180, fps: 10, kbps: 600 },
  { label: 'Vừa — 640×360 @15', w: 640, h: 360, fps: 15, kbps: 1200 },
  { label: 'Rõ — 854×480 @20', w: 854, h: 480, fps: 20, kbps: 2000 },
];

function formFrom(cfg: ConfigStream): Form {
  return {
    width: String(cfg.width ?? EMPTY.width),
    height: String(cfg.height ?? EMPTY.height),
    fps: String(cfg.fps ?? EMPTY.fps),
    bitrateKbps: String(cfg.bitrateKbps ?? EMPTY.bitrateKbps),
    preset: String(cfg.preset || EMPTY.preset),
    captureSource: String(cfg.captureSource || EMPTY.captureSource),
    cameraDevice: String(cfg.cameraDevice ?? ''),
    captureCursor: cfg.captureCursor !== false,
    autoRestart: cfg.autoRestart !== false,
    autoRestartMax: String(cfg.autoRestartMax ?? 5),
    autoRestartDelaySec: String(Math.round((cfg.autoRestartDelayMs ?? 10000) / 1000)),
  };
}

export function SettingsPanel() {
  const { acctId, refresh } = useApp();
  const act = useAction();
  const [form, setForm] = useState<Form>(EMPTY);
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const load = async () => {
    setLoading(true);
    const res = await apiGet<ConfigState>('/api/config');
    if (res.ok && res.config?.stream) {
      setForm(formFrom(res.config.stream));
      setPath(res.path || '');
      setLoadErr('');
    } else {
      setLoadErr(res.error || 'Không đọc được cấu hình');
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acctId]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setForm((prev) => ({
      ...prev,
      width: String(p.w),
      height: String(p.h),
      fps: String(p.fps),
      bitrateKbps: String(p.kbps),
    }));
  };

  const save = async () => {
    const res = await act.run(() =>
      apiPost('/api/config/save', {
        stream: {
          width: Number(form.width),
          height: Number(form.height),
          fps: Number(form.fps),
          bitrateKbps: Number(form.bitrateKbps),
          preset: form.preset,
          captureSource: 'black',
          cameraDevice: '',
          captureCursor: form.captureCursor,
          autoRestart: form.autoRestart,
          autoRestartMax: Number(form.autoRestartMax),
          autoRestartDelayMs: Number(form.autoRestartDelaySec) * 1000,
        },
      }),
    );
    if (res.ok) {
      await load();
      await refresh();
    }
  };

  return (
    <div className="panel">
      <div className="grid two">
        <Card title="Chất lượng stream" hint={loading ? 'đang tải…' : undefined} i={0}>
          <Field label="Mẫu nhanh">
            <div className="row wrap">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  className="small"
                  type="button"
                  disabled={loading}
                  onClick={() => applyPreset(p)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>

          <div className="fields" style={{ marginTop: 12 }}>
            <Field label="Chiều rộng (px)">
              <input
                type="number"
                min={320}
                max={2560}
                step={2}
                value={form.width}
                disabled={loading}
                onChange={(e) => set('width', e.target.value)}
              />
            </Field>
            <Field label="Chiều cao (px)">
              <input
                type="number"
                min={240}
                max={1440}
                step={2}
                value={form.height}
                disabled={loading}
                onChange={(e) => set('height', e.target.value)}
              />
            </Field>
            <Field label="FPS">
              <input
                type="number"
                min={1}
                max={60}
                value={form.fps}
                disabled={loading}
                onChange={(e) => set('fps', e.target.value)}
              />
            </Field>
            <Field label="Bitrate (kbps)">
              <input
                type="number"
                min={500}
                max={8000}
                step={100}
                value={form.bitrateKbps}
                disabled={loading}
                onChange={(e) => set('bitrateKbps', e.target.value)}
              />
            </Field>
            <Field label="Nguồn hình">
              <input type="text" value="Hình đen" disabled readOnly />
            </Field>
            <Field label="Encoder">
              <select
                value={form.preset}
                disabled={loading}
                onChange={(e) => set('preset', e.target.value)}
              >
                {['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="form-sec">
            <h3>Tự dựng lại khi stream đứt</h3>
            <Toggle checked={form.autoRestart} onChange={(v) => set('autoRestart', v)}>
              Tự bắt lại stream khi ffmpeg lỗi, mất frame hoặc rớt kết nối
            </Toggle>
            <div className="fields">
              <Field label="Số lần tối đa">
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={form.autoRestartMax}
                  disabled={loading || !form.autoRestart}
                  onChange={(e) => set('autoRestartMax', e.target.value)}
                />
              </Field>
              <Field label="Chờ giữa các lần (giây)">
                <input
                  type="number"
                  min={3}
                  max={600}
                  value={form.autoRestartDelaySec}
                  disabled={loading || !form.autoRestart}
                  onChange={(e) => set('autoRestartDelaySec', e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={act.busy || loading} onClick={() => void save()}>
              Lưu cấu hình
            </button>
            <button className="small" disabled={act.busy || loading} onClick={() => void load()}>
              Tải lại
            </button>
          </div>
          {loadErr ? <Msg state={{ kind: 'err', text: loadErr }} /> : null}
          <Msg state={act.msg} />
        </Card>

        <Card title="Thông tin" i={1}>
          <KV k="File cấu hình" v={path || 'config.json'} />
          <KV
            k="Độ phân giải"
            v={`${form.width || '—'} × ${form.height || '—'}`}
          />
          <KV k="FPS" v={form.fps || '—'} />
          <KV k="Bitrate" v={`${form.bitrateKbps || '—'} kbps`} />
          <KV
            k="Nguồn"
            v={<Badge tone="warn">{SOURCE_LABEL[form.captureSource] || 'Hình đen'}</Badge>}
          />
          <KV
            k="Tự dựng lại"
            v={
              form.autoRestart
                ? `${form.autoRestartMax || 0} lần · chờ ${form.autoRestartDelaySec || 0}s`
                : 'tắt'
            }
            tone={form.autoRestart ? 'good' : ''}
          />
        </Card>
      </div>
    </div>
  );
}
