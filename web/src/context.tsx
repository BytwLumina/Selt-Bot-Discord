import { createContext, useContext } from 'react';
import type { Guild, Status, Tab } from './types';

export type ToastKind = 'ok' | 'err' | 'info';

export interface AppContextValue {
  status: Status | null;
  guilds: Guild[];
  acctId: string;
  tab: Tab;
  refresh: () => Promise<void>;
  reloadGuilds: () => Promise<void>;
  switchAccount: (id: string) => Promise<void>;
  navigate: (tab: Tab) => void;
  notify: (text: string, kind?: ToastKind) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('AppContext chưa sẵn sàng');
  return v;
}
