import { useState } from 'react';
import { apiPost } from '../api';
import { useApp } from '../context';
import { useAction } from '../hooks/useAction';
import { fmtDateTime, fmtDur } from '../lib/format';
import { Badge, Card, Empty, KV, Msg } from '../components/ui';
import type { AfkState } from '../types';

export function AfkPanel() {
  const { status, refresh } = useApp();
  const act = useAction();
  const [reason, setReason] = useState('');
  const a: AfkState = status?.afk || {};
  const pingers = a.topPingers || [];

  const on = async () => {
    await act.run(() => apiPost('/api/afk/on', { reason: reason.trim() }));
    await refresh();
  };
  const off = async () => {
    await act.run(() => apiPost('/api/afk/off'));
    await refresh();
  };

  return (
    <div className="panel">
      <div className="grid two">
        <Card
          title="Trạng thái"
          hint={a.enabled ? <Badge tone="warn">đang bật</Badge> : null}
          i={0}
        >
          <KV
            k="AFK"
            v={a.enabled ? (a.silentMode ? 'BẬT (silent)' : 'BẬT') : 'TẮT'}
            tone={a.enabled ? 'warn' : ''}
          />
          <KV k="Lý do" v={a.reason || '—'} />
          <KV k="Đã ping / đã trả lời" v={`${a.totalPings || 0} / ${a.totalReplies || 0}`} />
          <KV k="Bật lúc" v={a.setAt ? fmtDateTime(a.setAt) : '—'} />
          <KV
            k="Đã bật được"
            v={a.enabled && a.setAt ? fmtDur((Date.now() - a.setAt) / 1000) : '—'}
          />
          <KV k="Chế độ" v={a.enabled ? (a.silentMode ? 'im lặng' : 'trả lời bình thường') : '—'} />
          <KV k="Cảm xúc" v={a.reactEmoji || '—'} />

          <form
            className="row"
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void on();
            }}
          >
            <input
              type="text"
              value={reason}
              placeholder="Lý do (không bắt buộc)"
              maxLength={200}
              className="grow"
              onChange={(e) => setReason(e.target.value)}
            />
            <button className="primary" type="submit" disabled={act.busy}>
              Bật
            </button>
            <button className="danger" type="button" disabled={act.busy || !a.enabled} onClick={() => void off()}>
              Tắt
            </button>
          </form>
          <Msg state={act.msg} />
        </Card>

        <Card title="Top người ping" hint={pingers.length ? `${pingers.length} người` : ''} i={1}>
          <div className="list">
            {pingers.length ? (
              pingers.map((p) => (
                <div className="item" key={p.tag}>
                  <div className="left">
                    <div className="who">{p.tag}</div>
                  </div>
                  <div className="right">
                    <Badge tone="good">× {p.count}</Badge>
                  </div>
                </div>
              ))
            ) : (
              <Empty>Chưa có ai ping</Empty>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
