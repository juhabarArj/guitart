// Reconocimiento de acordes por nombre a partir de las notas de la tablatura, y diagramas.
import { midiName } from '../audio/pitch';
import type { TabNote } from './fingering';

interface Quality {
  id: string;
  iv: number[];
  sym: string;
  es: string;
}

export const QUALITIES: Quality[] = [
  { id: '', iv: [0, 4, 7], sym: '', es: 'mayor' },
  { id: 'm', iv: [0, 3, 7], sym: 'm', es: 'menor' },
  { id: '7', iv: [0, 4, 7, 10], sym: '7', es: 'séptima' },
  { id: 'maj7', iv: [0, 4, 7, 11], sym: 'maj7', es: 'séptima mayor' },
  { id: 'm7', iv: [0, 3, 7, 10], sym: 'm7', es: 'menor séptima' },
  { id: 'sus2', iv: [0, 2, 7], sym: 'sus2', es: 'sus2' },
  { id: 'sus4', iv: [0, 5, 7], sym: 'sus4', es: 'sus4' },
  { id: 'dim', iv: [0, 3, 6], sym: 'dim', es: 'disminuido' },
  { id: 'aug', iv: [0, 4, 8], sym: 'aug', es: 'aumentado' },
  { id: '5', iv: [0, 7], sym: '5', es: 'quinta (power chord)' }
];

export interface ChordMark {
  step: number;
  root: number;
  quality: string;
  /** Cifrado americano: Am, C7, G… */
  name: string;
  /** Nombre en castellano: La menor, Do séptima… */
  latin: string;
}

export function chordNames(root: number, q: string, flats = false) {
  const qual = QUALITIES.find((x) => x.id === q) ?? QUALITIES[0];
  const n = midiName(60 + root, flats);
  const latin = q === '5' ? `${n.latin}5 (power chord)` : `${n.latin} ${qual.es}`;
  return { name: `${n.letter}${qual.sym}`, latin };
}

/**
 * Analiza la tablatura por ventanas (medio compás en 4/4, un compás en 3/4) y elige el acorde
 * que mejor explica las notas que suenan, con preferencia por el que tiene la nota más grave como raíz.
 */
export function detectChords(notes: TabNote[], beatsPerBar: number, flats = false): ChordMark[] {
  if (!notes.length) return [];
  const perBar = beatsPerBar * 4;
  const win = beatsPerBar % 2 === 0 ? perBar / 2 : perBar;
  const last = notes.reduce((m, n) => Math.max(m, n.step + n.dur), 0);
  const marks: ChordMark[] = [];
  for (let w0 = 0; w0 < last; w0 += win) {
    const w1 = w0 + win;
    const weight = new Array(12).fill(0);
    let bass: number | null = null;
    for (const n of notes) {
      const overlap = Math.min(n.step + n.dur, w1) - Math.max(n.step, w0);
      if (overlap <= 0) continue;
      weight[n.midi % 12] += overlap;
      if (bass == null || n.midi < bass) bass = n.midi;
    }
    const max = Math.max(...weight);
    const present = weight.filter((w) => w > max * 0.15).length;
    if (max === 0 || present < 2) continue;
    let best = { score: -Infinity, root: 0, q: '' };
    for (let root = 0; root < 12; root++) {
      for (const q of QUALITIES) {
        const pcs = new Set(q.iv.map((i) => (root + i) % 12));
        let score = 0;
        for (let pc = 0; pc < 12; pc++) score += pcs.has(pc) ? weight[pc] : -0.6 * weight[pc];
        // Falta la raíz o la quinta (o la tercera si el acorde la tiene): penalización
        for (const i of q.iv) if (weight[(root + i) % 12] < max * 0.1) score -= 0.5 * max;
        if (bass != null && bass % 12 === root) score += 0.35 * max;
        score -= 0.03 * q.iv.length * max; // ante la duda, el acorde más sencillo
        if (score > best.score) best = { score, root, q: q.id };
      }
    }
    const prev = marks[marks.length - 1];
    if (prev && prev.root === best.root && prev.quality === best.q) continue;
    marks.push({ step: w0, root: best.root, quality: best.q, ...chordNames(best.root, best.q, flats) });
  }
  return marks;
}

/** Formas habituales en afinación estándar, de la 6.ª a la 1.ª cuerda (-1 = no se toca). */
const OPEN: Record<string, number[]> = {
  C: [-1, 3, 2, 0, 1, 0], D: [-1, -1, 0, 2, 3, 2], E: [0, 2, 2, 1, 0, 0], G: [3, 2, 0, 0, 0, 3], A: [-1, 0, 2, 2, 2, 0],
  Am: [-1, 0, 2, 2, 1, 0], Dm: [-1, -1, 0, 2, 3, 1], Em: [0, 2, 2, 0, 0, 0],
  A7: [-1, 0, 2, 0, 2, 0], B7: [-1, 2, 1, 2, 0, 2], C7: [-1, 3, 2, 3, 1, 0], D7: [-1, -1, 0, 2, 1, 2], E7: [0, 2, 0, 1, 0, 0], G7: [3, 2, 0, 0, 0, 1],
  Am7: [-1, 0, 2, 0, 1, 0], Dm7: [-1, -1, 0, 2, 1, 1], Em7: [0, 2, 0, 0, 0, 0],
  Cmaj7: [-1, 3, 2, 0, 0, 0], Fmaj7: [-1, -1, 3, 2, 1, 0], Amaj7: [-1, 0, 2, 1, 2, 0], Dmaj7: [-1, -1, 0, 2, 2, 2], Gmaj7: [3, 2, 0, 0, 0, 2],
  Asus2: [-1, 0, 2, 2, 0, 0], Asus4: [-1, 0, 2, 2, 3, 0], Dsus2: [-1, -1, 0, 2, 3, 0], Dsus4: [-1, -1, 0, 2, 3, 3], Esus4: [0, 2, 2, 2, 0, 0],
  E5: [0, 2, 2, -1, -1, -1], A5: [-1, 0, 2, 2, -1, -1], D5: [-1, -1, 0, 2, 3, -1]
};

/** Formas móviles con cejilla: raíz en la 6.ª (forma de Mi) o en la 5.ª (forma de La), relativas al traste r. */
const E_SHAPE: Record<string, number[]> = {
  '': [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], '7': [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0],
  maj7: [0, -1, 1, 1, 0, -1], sus4: [0, 2, 2, 2, 0, 0], '5': [0, 2, 2, -1, -1, -1]
};
const A_SHAPE: Record<string, number[]> = {
  '': [-1, 0, 2, 2, 2, 0], m: [-1, 0, 2, 2, 1, 0], '7': [-1, 0, 2, 0, 2, 0], m7: [-1, 0, 2, 0, 1, 0],
  maj7: [-1, 0, 2, 1, 2, 0], sus2: [-1, 0, 2, 2, 0, 0], sus4: [-1, 0, 2, 2, 3, 0], '5': [-1, 0, 2, 2, -1, -1],
  dim: [-1, 0, 1, 2, 1, -1], aug: [-1, 0, 3, 2, 2, 1]
};

/** Digitación de un acorde (solo afinación estándar). */
export function chordShape(root: number, quality: string): number[] | null {
  const open = OPEN[chordNames(root, quality).name.replace('♯', '#')];
  if (open) return open;
  const rE = (root - 4 + 12) % 12 || 12;
  const rA = (root - 9 + 12) % 12 || 12;
  const opts: number[][] = [];
  if (E_SHAPE[quality]) opts.push(E_SHAPE[quality].map((f) => (f < 0 ? -1 : f + rE)));
  if (A_SHAPE[quality]) opts.push(A_SHAPE[quality].map((f) => (f < 0 ? -1 : f + rA)));
  if (!opts.length) return null;
  const low = (s: number[]) => Math.min(...s.filter((f) => f > 0));
  return opts.sort((a, b) => low(a) - low(b))[0];
}
