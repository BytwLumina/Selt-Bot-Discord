import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, setAcct } from './api';
import { AppContext } from './context';
import type { ToastKind } from './context';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Rail } from './components/Rail';
import { ToastHost } from './components/ToastHost';
import type { ToastItem } from './components/ToastHost';
import { applyTheme, readTheme } from './lib/theme';
import type { Theme } from './lib/theme';
import { fmtDur } from './lib/format';
import { PAGE_META, isTab } from './tabs';
import type { Guild, Status, Tab } from './types';
import { OverviewPanel } from './panels/Overview';
import { MediaPanel } from './panels/Media';
import { SettingsPanel } from './panels/Settings';
import { AfkPanel } from './panels/Afk';
import { OwoPanel } from './panels/Owo';
import { RpcPanel } from './panels/Rpc';
import { SnipePanel } from './panels/Snipe';
import { LogsPanel } from './panels/Logs';

const TAB_KEY = 'lumina-tab';

function initialTab(): Tab {
  const h = location.hash.replace(/^#/, '');
  if (isTab(h)) return h;
  try {
    const saved = localStorage.getItem(TAB_KEY) || '';
    if (isTab(saved)) return saved;
  } catch {
    /* bỏ qua */
  }
  return 'overview';
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [status, setStatus] = useState<Status | null>(null);
  const [online, setOnline] = useState(true);
  const [bootError, setBootError] = useState('');
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [acctId, setAcctId] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const meta = PAGE_META[tab];
    document.title = 'Lumina — ' + meta.title;
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* bỏ qua */
    }
    history.replaceState(null, '', '#' + tab);
    window.scrollTo({ top: 0 });
  }, [tab]);

  useEffect(() => {
    const onHash = () => {
      const h = location.hash.replace(/^#/, '');
      if (isTab(h)) setTab(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((text: string, kind: ToastKind = 'info') => {
    if (!text) return;
    const id = ++seq.current;
    setToasts((list) => [...list.slice(-3), { id, text, kind }]);
  }, []);

  const refresh = useCallback(async () => {
    const s = await apiGet<Status>('/api/status');
    if (!s.ok) {
      setOnline(false);
      setBootError(s.error || 'Không kết nối được server');
      return;
    }
    setOnline(true);
    setBootError('');
    setStatus(s);
    const id = s.account?.id || '';
    setAcct(id);
    setAcctId(id);
  }, []);

  const reloadGuilds = useCallback(async () => {
    const res = await apiGet<{ ok: boolean; guilds?: Guild[] }>('/api/guilds');
    setGuilds(res.ok && Array.isArray(res.guilds) ? res.guilds : []);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 2000);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (!status?.loggedIn) {
      setGuilds((prev) => (prev.length ? [] : prev));
      return;
    }
    void reloadGuilds();
  }, [status?.loggedIn, acctId, reloadGuilds]);

  const switchAccount = useCallback(
    async (id: string) => {
      if (!id || id === acctId) return;
      const res = await apiPost('/api/accounts/focus', { id });
      if (!res.ok) {
        notify(res.error || 'Không chuyển được account', 'err');
        return;
      }
      setAcct(id);
      setAcctId(id);
      setGuilds([]);
      await refresh();
      notify('Đang điều khiển: ' + id, 'ok');
    },
    [acctId, notify, refresh],
  );

  const navigate = useCallback((next: Tab) => setTab(next), []);
  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const meta = PAGE_META[tab];
  const loggedIn = !!status?.loggedIn;

  if (!status) {
    return (
      <div className="boot">
        {bootError ? (
          <div className="boot-card">
            <b>Không kết nối được panel</b>
            <p>{bootError}</p>
            <p className="boot-hint">
              Kiểm tra selfbot đang chạy và mở đúng địa chỉ 127.0.0.1 trong config.json.
            </p>
            <button className="primary" onClick={() => void refresh()}>
              Thử lại
            </button>
          </div>
        ) : (
          <div className="boot-skel" aria-label="Đang tải panel">
            <div className="skel-rail" />
            <div className="skel-main">
              <div className="skel-line w35" />
              <div className="skel-line w22" />
              <div className="skel-tiles">
                {[0, 1, 2, 3].map((i) => (
                  <div className="skel-tile" key={i} />
                ))}
              </div>
              <div className="skel-card" />
              <div className="skel-card short" />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <AppContext.Provider
      value={{
        status,
        guilds,
        acctId,
        tab,
        refresh,
        reloadGuilds,
        switchAccount,
        navigate,
        notify,
      }}
    >
      <div className="app">
        <Rail
          tab={tab}
          onSelect={navigate}
          status={status}
          acctId={acctId}
          onSwitch={(id) => void switchAccount(id)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <div className="main">
          <header className="topbar">
            <div className="page-head" key={tab}>
              <h1>{meta.title}</h1>
            </div>
            <div className="top-right">
              <span className={loggedIn && online ? 'status-chip live' : 'status-chip off'}>
                <i className="dot" aria-hidden="true" />
                <b>{loggedIn ? (online ? 'Trực tuyến' : 'Mất kết nối') : 'Ngoại tuyến'}</b>
                <i className="sep" aria-hidden="true" />
                <span className="figures">
                  {loggedIn
                    ? `${status.ping}ms · ${fmtDur((status.stats?.uptimeMs || 0) / 1000)}`
                    : 'Chưa đăng nhập'}
                </span>
              </span>
            </div>
          </header>

          <ErrorBoundary key={tab}>
            <div className="content" key={tab}>
              {tab === 'overview' ? <OverviewPanel /> : null}
              {tab === 'media' ? <MediaPanel /> : null}
              {tab === 'afk' ? <AfkPanel /> : null}
              {tab === 'owo' ? <OwoPanel /> : null}
              {tab === 'rpc' ? <RpcPanel /> : null}
              {tab === 'snipe' ? <SnipePanel /> : null}
              {tab === 'log' ? <LogsPanel /> : null}
              {tab === 'settings' ? <SettingsPanel /> : null}
            </div>
          </ErrorBoundary>
        </div>
      </div>

      <ToastHost toasts={toasts} onDone={dismissToast} />
    </AppContext.Provider>
  );
}
