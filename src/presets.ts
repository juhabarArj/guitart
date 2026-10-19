import { defaultBoard, normalizeBoard, type BoardState, type PedalState } from './audio/chain';
import type { EffectType } from './audio/effects';
import { run } from './storage/db';

export interface Preset {
  id: string;
  name: string;
  factory?: boolean;
  board: BoardState;
}

function board(order: EffectType[], pedals: Partial<Record<EffectType, Partial<PedalState['params']> | false>>): BoardState {
  const base = defaultBoard();
  const byType = Object.fromEntries(base.map((p) => [p.type, p])) as Record<EffectType, PedalState>;
  for (const [type, params] of Object.entries(pedals) as [EffectType, Partial<PedalState['params']> | false][]) {
    if (params === false) continue;
    byType[type] = { ...byType[type], enabled: true, params: { ...byType[type].params, ...params } as Record<string, number> };
  }
  return order.map((t) => byType[t]);
}

const STD: EffectType[] = ['gate', 'comp', 'drive', 'eq', 'chorus', 'delay', 'reverb'];

export const FACTORY_PRESETS: Preset[] = [
  {
    id: 'factory:clean',
    name: 'Limpio',
    factory: true,
    board: board(STD, {
      gate: { threshold: -65 },
      comp: { threshold: -28, ratio: 3, makeup: 5 },
      eq: { low: 1, mid: 0, high: 2 },
      reverb: { decay: 1.8, tone: 60, mix: 22 }
    })
  },
  {
    id: 'factory:crunch',
    name: 'Crunch',
    factory: true,
    board: board(STD, {
      gate: { threshold: -58 },
      drive: { mode: 0, drive: 45, tone: 55, level: -14 },
      eq: { low: 0, mid: 2, high: 1 },
      reverb: { decay: 1.4, tone: 50, mix: 15 }
    })
  },
  {
    id: 'factory:lead',
    name: 'Solo',
    factory: true,
    board: board(STD, {
      gate: { threshold: -52 },
      comp: { threshold: -30, ratio: 4, makeup: 6 },
      drive: { mode: 1, drive: 72, tone: 50, level: -18 },
      eq: { low: -1, mid: 3, high: 0 },
      delay: { time: 380, feedback: 30, tone: 45, mix: 25 },
      reverb: { decay: 2.2, tone: 50, mix: 18 }
    })
  },
  {
    id: 'factory:ambient',
    name: 'Ambiental',
    factory: true,
    board: board(STD, {
      gate: { threshold: -66 },
      comp: { threshold: -26, ratio: 3, makeup: 5 },
      chorus: { rate: 0.6, depth: 55, mix: 45 },
      delay: { time: 520, feedback: 45, tone: 40, mix: 35 },
      reverb: { decay: 4.5, tone: 55, mix: 40 }
    })
  }
];

export const sameBoard = (a: BoardState, b: BoardState) => JSON.stringify(a) === JSON.stringify(b);

export async function listUserPresets(): Promise<Preset[]> {
  const all = await run<Preset[]>('presets', 'readonly', (s) => s.getAll());
  return all.map((p) => ({ ...p, board: normalizeBoard(p.board) })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export const savePreset = (p: Preset) => run('presets', 'readwrite', (s) => s.put({ ...p, factory: undefined }));
export const deletePreset = (id: string) => run('presets', 'readwrite', (s) => s.delete(id));

/** Formato de archivo: { app: 'guitart', version: 1, presets: [{ name, board }] } */
export function exportPresets(presets: Preset[]): Blob {
  const data = { app: 'guitart', version: 1, presets: presets.map((p) => ({ name: p.name, board: p.board })) };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export function parsePresetFile(text: string): Preset[] {
  const data = JSON.parse(text);
  const list: unknown[] = Array.isArray(data?.presets) ? data.presets : Array.isArray(data) ? data : [data];
  const out = list
    .filter((p): p is { name?: unknown; board?: unknown } => typeof p === 'object' && p !== null && 'board' in p)
    .map((p) => ({
      id: crypto.randomUUID(),
      name: (typeof p.name === 'string' && p.name.trim().slice(0, 60)) || 'Importado',
      board: normalizeBoard(p.board)
    }));
  if (out.length === 0) throw new Error('El archivo no contiene presets de Guitart.');
  return out;
}
