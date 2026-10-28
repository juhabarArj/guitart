import { useEffect, useState } from 'react';
import type { ChannelMode, RecordSource } from './audio/engine';
import { DEFAULT_BINDINGS, type Bindings } from './control/actions';

export type ThemeName = 'auto' | 'light' | 'dark' | 'ebook' | 'dire';
export type TabName = 'audio' | 'board' | 'looper' | 'songs' | 'studio' | 'tab' | 'control';

export interface Settings {
  inputId: string;
  outputId: string;
  channelMode: ChannelMode;
  gainDb: number;
  monitorVolume: number;
  a4: number;
  recordSource: RecordSource;
  theme: ThemeName;
  tab: TabName;
  lowLatency: boolean;
  wakeLock: boolean;
  tuning: string;
  /** Latencias medidas (ms) por combinación de entrada, salida y modo de latencia */
  measured: Record<string, number>;
  bindings: Bindings;
  /** Los cambios de programa MIDI eligen preset */
  midiPc: boolean;
}

const KEY = 'guitart:settings';
const DEFAULTS: Settings = {
  inputId: '',
  outputId: '',
  channelMode: 'left',
  gainDb: 0,
  monitorVolume: 0.8,
  a4: 440,
  recordSource: 'wet',
  theme: 'auto',
  tab: 'audio',
  lowLatency: false,
  wakeLock: true,
  tuning: 'standard',
  measured: {},
  bindings: DEFAULT_BINDINGS,
  midiPc: true
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      return { ...DEFAULTS, ...saved, bindings: { ...DEFAULT_BINDINGS, ...saved.bindings } };
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
