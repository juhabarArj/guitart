// Elección de cuerda y traste: busca la digitación con menos desplazamiento de la mano (Viterbi).
import type { RawNote } from './transcribe';

export interface TabNote {
  id: string;
  /** Posición y duración en semicorcheas desde el inicio del compás 1 */
  step: number;
  dur: number;
  midi: number;
  /** 0 = 6.ª cuerda (la más grave) … 5 = 1.ª */
  string: number;
  fret: number;
}

export const MAX_FRET = 22;

export function positions(midi: number, tuning: number[]): { string: number; fret: number }[] {
  const out: { string: number; fret: number }[] = [];
  tuning.forEach((open, s) => {
    const fret = midi - open;
    if (fret >= 0 && fret <= MAX_FRET) out.push({ string: s, fret });
  });
  return out;
}

function cost(a: { string: number; fret: number } | null, b: { string: number; fret: number }) {
  let c = b.fret * 0.04; // ligera preferencia por posiciones bajas
  if (b.fret > 12) c += 0.5;
  if (!a) return c;
  if (a.fret === 0 || b.fret === 0) return c + Math.abs(a.string - b.string) * 0.15;
  const jump = Math.abs(a.fret - b.fret);
  c += jump * 0.6;
  if (jump > 4) c += 2.5; // fuera del alcance de la mano
  c += Math.abs(a.string - b.string) * 0.15;
  return c;
}

/** Asigna cuerda y traste a una secuencia de notas (en orden temporal). */
export function assignFingering<T extends { midi: number }>(notes: T[], tuning: number[]): ({ string: number; fret: number } | null)[] {
  const options = notes.map((n) => positions(n.midi, tuning));
  const dp: number[][] = [];
  const back: number[][] = [];
  options.forEach((opts, i) => {
    dp[i] = [];
    back[i] = [];
    opts.forEach((o, j) => {
      if (i === 0 || !options[i - 1].length) {
        dp[i][j] = cost(null, o) + (i > 0 ? Math.min(...(dp[i - 1].length ? dp[i - 1] : [0])) : 0);
        back[i][j] = -1;
        return;
      }
      let best = Infinity;
      let arg = 0;
      options[i - 1].forEach((p, k) => {
        const v = dp[i - 1][k] + cost(p, o);
        if (v < best) {
          best = v;
          arg = k;
        }
      });
      dp[i][j] = best;
      back[i][j] = arg;
    });
  });
  // Reconstrucción hacia atrás
  const out: ({ string: number; fret: number } | null)[] = new Array(notes.length).fill(null);
  let j = -1;
  for (let i = notes.length - 1; i >= 0; i--) {
    if (!options[i].length) {
      j = -1;
      continue;
    }
    if (j < 0) j = dp[i].indexOf(Math.min(...dp[i]));
    out[i] = options[i][j];
    j = back[i][j];
  }
  return out;
}

/** Ajusta las notas a la rejilla de semicorcheas y les asigna cuerda y traste. */
export function quantize(raw: RawNote[], bpm: number, offset: number, tuning: number[]): TabNote[] {
  const sd = 60 / bpm / 4;
  const items: { step: number; dur: number; midi: number }[] = [];
  for (const n of raw) {
    const step = Math.round((n.t - offset) / sd);
    if (step < 0) continue;
    const dur = Math.max(1, Math.round((n.end - n.t) / sd));
    const last = items[items.length - 1];
    if (last && last.step === step) continue; // dos ataques en la misma casilla: se queda el primero
    items.push({ step, dur, midi: n.midi });
  }
  // Monofónico: ninguna nota se solapa con la siguiente
  for (let i = 0; i < items.length - 1; i++) items[i].dur = Math.max(1, Math.min(items[i].dur, items[i + 1].step - items[i].step));
  const fing = assignFingering(items, tuning);
  const out: TabNote[] = [];
  items.forEach((it, i) => {
    const f = fing[i];
    if (f) out.push({ id: crypto.randomUUID() as string, ...it, ...f });
  });
  return out;
}
