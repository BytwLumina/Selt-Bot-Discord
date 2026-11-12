import type { Tab } from './types';
import type { IconName } from './components/icons';

export const PAGE_META: Record<Tab, { title: string }> = {
  overview: { title: 'Tổng quan' },
  media: { title: 'Voice & Stream' },
  afk: { title: 'AFK' },
  owo: { title: 'OwO Farm' },
  rpc: { title: 'Rich Presence' },
  snipe: { title: 'Snipe' },
  log: { title: 'Log' },
  settings: { title: 'Cài đặt' },
};

export const NAV_ITEMS: { tab: Tab; label: string; icon: IconName }[] = [
  { tab: 'overview', label: 'Tổng quan', icon: 'grid' },
  { tab: 'media', label: 'Voice & Stream', icon: 'mic' },
  { tab: 'afk', label: 'AFK', icon: 'moon' },
  { tab: 'owo', label: 'OwO Farm', icon: 'bot' },
  { tab: 'rpc', label: 'Rich Presence', icon: 'sparkle' },
  { tab: 'snipe', label: 'Snipe', icon: 'target' },
  { tab: 'log', label: 'Log', icon: 'terminal' },
  { tab: 'settings', label: 'Cài đặt', icon: 'sliders' },
];

export function isTab(value: string): value is Tab {
  return Object.prototype.hasOwnProperty.call(PAGE_META, value);
}
