import type { Status, Tab } from '../types';
import type { Theme } from '../lib/theme';
import { NAV_ITEMS } from '../tabs';
import { Icon } from './icons';

interface RailProps {
  tab: Tab;
  onSelect: (tab: Tab) => void;
  status: Status | null;
  acctId: string;
  onSwitch: (id: string) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export function Rail({ tab, onSelect, status, acctId, onSwitch, theme, onToggleTheme }: RailProps) {
  const accounts = status?.accounts || [];
  const loggedIn = !!status?.loggedIn;
  const user = status?.user?.tag;

  return (
    <aside className="rail">
      <div className="brand">
        <span className="logo">
          <img src="/assets/logo.jpg" alt="" width={28} height={28} />
        </span>
        <div className="wordmark">
          <b>Lumina</b>
          <span>selfbot</span>
        </div>
      </div>

      <nav className="nav" aria-label="Điều hướng">
        <div className="nav-label">Bảng điều khiển</div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.tab}
            type="button"
            className={item.tab === tab ? 'tab active' : 'tab'}
            aria-current={item.tab === tab ? 'page' : undefined}
            onClick={() => onSelect(item.tab)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="rail-foot">
        <div className={loggedIn ? 'conn' : 'conn off'}>
          <span className="dot" aria-hidden="true" />
          <span className="meta" title={user || 'Chưa đăng nhập'}>
            {loggedIn
              ? `${user || '?'} · ${status?.guildCount || 0} sever`
              : 'Chưa đăng nhập'}
          </span>
        </div>
        <div className="rail-actions">
          <select
            className="acct-select"
            title="Đổi account đang điều khiển"
            value={acctId}
            disabled={!accounts.length}
            onChange={(e) => onSwitch(e.target.value)}
          >
            {accounts.length ? (
              accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name + (a.ready ? '' : ' (lỗi)')}
                </option>
              ))
            ) : (
              <option value="">Chưa có account</option>
            )}
          </select>
          <button
            type="button"
            className="icon ghost"
            title={theme === 'dark' ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối'}
            aria-label={theme === 'dark' ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối'}
            onClick={onToggleTheme}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
      </div>
    </aside>
  );
}
