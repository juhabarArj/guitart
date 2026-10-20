import { useEffect } from 'react';
import type { ThemeName } from './settings';

export const THEMES: { value: ThemeName; label: string }[] = [
  { value: 'auto', label: 'Automático' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
  { value: 'ebook', label: 'eBook' },
  { value: 'dire', label: 'Dire' }
];

/** Aplica el tema en <html data-theme> y ajusta el color de la barra del sistema (PWA instalada). */
export function useTheme(theme: ThemeName) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;

    const syncBar = () => {
      const color = getComputedStyle(root).getPropertyValue('--steel').trim();
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    };
    syncBar();
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', syncBar);
    return () => mq.removeEventListener('change', syncBar);
  }, [theme]);
}

export function ThemeSelect({ value, onChange }: { value: ThemeName; onChange: (t: ThemeName) => void }) {
  return (
    <label className="theme-select">
      <span>Tema</span>
      <select value={value} onChange={(e) => onChange(e.target.value as ThemeName)}>
        {THEMES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
