import { useEffect, useRef, useState } from 'react';
import { apiPost } from '../api';
import { useApp } from '../context';
import { useAction } from '../hooks/useAction';
import { fmtDur } from '../lib/format';
import { Badge, Card, Empty, KV, Msg, Tile } from '../components/ui';
import { RequestChart } from '../components/RequestChart';
import type { AccountInfo, StatsState, Status } from '../types';

const STAT_KEYS: [keyof StatsState & string, string][] = [
  ['messagesReceived', 'Messages'],
  ['commandsExecuted', 'Lệnh chạy'],
  ['commandsFailed', 'Lệnh lỗi'],
  ['voiceJoins', 'Voice vào'],
  ['streamStarts', 'Stream bật'],
  ['streamWatches', 'Xem stream'],
  ['afkPings', 'AFK ping'],
  ['afkReplies', 'AFK trả lời'],
  ['messagesDeleted', 'Tin xoá'],
  ['errors', 'Lỗi'],
];

function statusRows(s: Status) {
  const v = s.voice;
  const st = s.stream;
  const w = s.watch;
  const a = s.afk;
  const oo = s.owo;
  const r = s.rpc;

  return [
    {
      k: 'Voice',
      v: v?.connected ? 'Đang ở voice' : v?.connecting ? 'Đang kết nối' : 'Không ở voice',
      tone: v?.connected ? ('good' as const) : ('' as const),
    },
    {
      k: 'Stream',
      v: st?.active ? (st.paused ? 'LIVE (tạm dừng)' : 'LIVE') : st?.starting ? 'Đang bắt đầu' : 'Tắt',
      tone: st?.active ? ('bad' as const) : ('' as const),
    },
    {
      k: 'Xem stream',
      v: w?.active || w?.starting ? 'Đang xem ' + (w.username || w.userId || '') : 'Không xem',
      tone: w?.active ? ('accent' as const) : ('' as const),
    },
    {
      k: 'AFK',
      v: a?.enabled ? 'BẬT' + (a.reason ? ' — ' + a.reason : '') : 'Tắt',
      tone: a?.enabled ? ('warn' as const) : ('' as const),
    },
    {
      k: 'OwO farm',
      v: oo?.enabled ? 'ĐANG CHẠY' : oo?.paused ? 'Tạm dừng (' + oo.paused + ')' : 'Tắt',
      tone: oo?.enabled ? ('good' as const) : oo?.paused ? ('bad' as const) : ('' as const),
    },
    {
      k: 'Rich Presence',
      v: r?.enabled ? (r.applied ? 'Bật' : 'Bật (chưa áp dụng)') : 'Tắt',
      tone: r?.enabled ? ('good' as const) : ('' as const),
    },
    {
      k: 'Tài khoản',
      v: s.loggedIn ? `${s.user?.tag} · ${s.user?.id}` : 'Chưa đăng nhập',
      tone: '' as const,
    },
  ];
}

export function OverviewPanel() {
  const { status, acctId, refresh, switchAccount, navigate, notify } = useApp();
  const quick = useAction();
  const acctAct = useAction();
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [pendingRemove, setPendingRemove] = useState('');
  const removeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (removeTimer.current) window.clearTimeout(removeTimer.current);
    };
  }, []);

  if (!status) return null;

  const s = status;
  const loggedIn = !!s.loggedIn;
  const stats: StatsState = s.stats || {};
  const session = s.session;
  const accounts: AccountInfo[] = Array.isArray(s.accounts) ? s.accounts : [];
  const live = accounts.filter((a) => a.ready).length;
  const focusedId = s.focusedId || acctId;

  let sessionValue = '—';
  let sessionSub = 'còn bao lâu';
  let sessionTone: '' | 'good' | 'warn' | 'bad' = '';
  if (session?.unlimited) {
    sessionValue = '∞';
    sessionSub = 'không giới hạn';
    sessionTone = 'good';
  } else if (session && (session.maxMs || 0) > 0) {
    const pct = Math.min(100, Math.round(((session.elapsed || 0) / (session.maxMs || 1)) * 100));
    sessionValue = pct + '%';
    sessionSub = 'còn ' + fmtDur(Math.max(0, (session.maxMs || 0) - (session.elapsed || 0)) / 1000);
    sessionTone = pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'good';
  }

  const ping = Math.max(0, Number(s.ping) || 0);
  const pingTone = !loggedIn ? '' : ping < 120 ? 'good' : ping < 250 ? 'warn' : 'bad';

  const health = s.health;
  let healthText = '';
  if (health) {
    if (!health.enabled) healthText = 'watchdog tắt';
    else {
      const down = (health.accounts || []).filter((x) => (x.downMs || 0) > 0).length;
      healthText =
        `watchdog ${Math.round(health.intervalMs / 1000)}s · chờ ${Math.round(health.graceMs / 1000)}s` +
        (down ? ` · ${down} account đang rớt` : '');
    }
  }

  const goLive = async () => {
    const res = await quick.run(() => apiPost('/api/stream/start'));
    if (res.ok) navigate('media');
  };

  const toggleAfk = async () => {
    const on = !!s.afk?.enabled;
    await quick.run(() => apiPost(on ? '/api/afk/off' : '/api/afk/on', { reason: '' }));
    await refresh();
  };

  const rpcReload = async () => {
    await quick.run(() => apiPost('/api/rpc/reload'));
    await refresh();
  };

  const addAccount = async () => {
    if (!token.trim()) {
      acctAct.setMsg({ kind: 'err', text: 'Lỗi: Cần nhập token Discord' });
      notify('Cần nhập token Discord', 'err');
      return;
    }
    const res = await acctAct.run(() =>
      apiPost('/api/accounts', { name: name.trim(), token: token.trim() }),
    );
    setToken('');
    if (res.ok) {
      setName('');
      await refresh();
    }
  };

  const retryAccount = async (a: AccountInfo) => {
    const res = await acctAct.run(() => apiPost('/api/accounts/retry', { id: a.id }));
    if (res.ok) await refresh();
  };

  const askRemove = async (a: AccountInfo) => {
    if (pendingRemove !== a.id) {
      setPendingRemove(a.id);
      window.clearTimeout(removeTimer.current);
      removeTimer.current = window.setTimeout(() => setPendingRemove(''), 5000);
      return;
    }
    window.clearTimeout(removeTimer.current);
    setPendingRemove('');
    const res = await acctAct.run(() => apiPost('/api/accounts/remove', { id: a.id }));
    if (res.ok) await refresh();
  };

  return (
    <div className="panel">
      <div className="tiles">
        <Tile
          label="Ping"
          value={loggedIn ? ping + 'ms' : '—'}
          sub="gateway"
          tone={pingTone}
          icon="activity"
          i={0}
        />
        <Tile
          label="Uptime"
          value={fmtDur((stats.uptimeMs || 0) / 1000)}
          sub="phiên hiện tại"
          icon="clock"
          i={1}
        />
        <Tile label="Session" value={sessionValue} sub={sessionSub} tone={sessionTone} icon="hourglass" i={2} />
        <Tile label="Sever" value={String(s.guildCount || 0)} sub="đang vào" icon="server" i={3} />
      </div>

      <div className="grid two">
        <Card title="Trạng thái" i={0}>
          {statusRows(s).map((row) => (
            <KV key={row.k} k={row.k} v={row.v} tone={row.tone} />
          ))}
        </Card>

        <div className="stack">
          <Card title="Thao tác nhanh" i={1}>
            <div className="row wrap">
              <button className="primary" disabled={quick.busy} onClick={() => void goLive()}>
                Go Live
              </button>
              <button disabled={quick.busy} onClick={() => navigate('media')}>
                Vào voice
              </button>
              <button disabled={quick.busy} onClick={() => navigate('media')}>
                Xem stream
              </button>
              <button disabled={quick.busy} onClick={() => void toggleAfk()}>
                Bật/Tắt AFK
              </button>
              <button className="ghost" disabled={quick.busy} onClick={() => void rpcReload()}>
                RPC reload
              </button>
            </div>
            <Msg state={quick.msg} />
          </Card>

          <Card title="Thêm account" i={2}>
            <form
              className="acct-add"
              onSubmit={(e) => {
                e.preventDefault();
                void addAccount();
              }}
            >
              <input
                type="text"
                value={name}
                placeholder="Tên (tuỳ chọn)"
                maxLength={32}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                type="password"
                value={token}
                placeholder="Token Discord"
                autoComplete="new-password"
                spellCheck={false}
                onChange={(e) => setToken(e.target.value)}
              />
              <button className="primary" type="submit" disabled={acctAct.busy}>
                Thêm
              </button>
            </form>
            <Msg state={acctAct.msg} />
          </Card>
        </div>
      </div>

      <Card
        title="Yêu cầu đã gửi đi"
        hint="30 phút gần nhất"
        i={4}
      >
        <RequestChart data={s.requests} />
      </Card>

      <Card
        title="Tài khoản"
        hint={
          <>
            {accounts.length ? `${live}/${accounts.length} đang chạy` : ''}
            {healthText ? ` · ${healthText}` : ''}
          </>
        }
        i={5}
      >
        <div className="list">
          {accounts.length ? (
            accounts.map((a) => (
              <div className="item" key={a.id}>
                <div className="left">
                  <span className={a.ready ? 'avatar' : 'avatar bad'}>
                    <i className="mark" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="who">
                      {a.name} · {a.id}
                    </div>
                    <div className="sub">
                      {a.user?.tag || (a.ready ? 'online' : a.error || 'chưa đăng nhập')}
                    </div>
                  </div>
                </div>
                <div className="right">
                  {a.ready ? (
                    <>
                      <Badge tone="good">đang chạy</Badge>
                      <Badge>{a.user?.tag || 'online'}</Badge>
                      {a.restarts ? (
                        <Badge title="Số lần tự đăng nhập lại">restart {a.restarts}</Badge>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Badge tone="bad">{a.error || 'lỗi'}</Badge>
                      <button
                        className="small"
                        disabled={acctAct.busy}
                        title="Đăng nhập lại account này"
                        onClick={() => void retryAccount(a)}
                      >
                        Thử lại
                      </button>
                    </>
                  )}
                  {a.id === focusedId ? (
                    <Badge tone="accent">đang focus</Badge>
                  ) : (
                    <button className="small" onClick={() => void switchAccount(a.id)}>
                      Chuyển
                    </button>
                  )}
                  <button
                    className={'small ' + (pendingRemove === a.id ? 'danger' : 'ghost')}
                    title="Xoá account + token khỏi file lưu trữ"
                    disabled={acctAct.busy}
                    onClick={() => void askRemove(a)}
                  >
                    {pendingRemove === a.id ? 'Xác nhận?' : 'Xoá'}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <Empty>Chưa có account — thêm token vào tokens.txt hoặc accounts.json</Empty>
          )}
        </div>
        <Msg state={acctAct.msg} />
      </Card>

      <Card title="Số liệu phiên" i={6}>
        <div className="stats-grid">
          {STAT_KEYS.map(([key, label]) => (
            <div className="kv" key={key}>
              <span className="k">{label}</span>
              <span className="v">{String(stats[key] ?? 0)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
