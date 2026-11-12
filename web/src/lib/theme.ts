export type Theme = 'dark' | 'light';

const KEY = 'lumina-theme';

export function readTheme(): Theme {
  try {
    const q = new URLSearchParams(location.search).get('theme');
    if (q === 'light' || q === 'dark') return q;
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* localStorage bị chặn */
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(theme: Theme, save = true): void {
  document.documentElement.setAttribute('data-theme', theme);
  if (save) {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* bỏ qua */
    }
  }
}
