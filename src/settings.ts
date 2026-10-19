import { useEffect, useState } from 'react';
import type { ChannelMode } from './audio/engine';

export interface Settings {
  inputId: string;
  outputId: string;
  channelMode: ChannelMode;
  gainDb: number;
  monitorVolume: number;
  a4: number;
}

const KEY = 'guitart:settings';
const DEFAULTS: Settings = {
  inputId: '',
  outputId: '',
  channelMode: 'left',
  gainDb: 0,
  monitorVolume: 0.8,
  a4: 440
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
      return DEFAULTS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* almacenamiento no disponible */
    }
  }, [settings]);

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  return [settings, update] as const;
}
