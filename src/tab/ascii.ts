// Tablatura de texto (la de números que se copia y pega), con técnicas y cifrado de acordes.
import { midiName } from '../audio/pitch';
import type { ChordMark } from './chords';
import type { TabNote } from './fingering';

/** Texto de una nota: h7 (hammer-on), p5 (pull-off), /9 y \5 (slides), 7b9 (bend hasta el traste 9), 7~ (vibrato). */
export function noteLabel(n: TabNote): string {
  const t = n.tech;
  return `${t?.from ?? ''}${n.fret}${t?.bend ? `b${n.fret + t.bend}` : ''}${t?.vib ? '~' : ''}`;
}

export function toAscii(
  notes: TabNote[],
  opts: {
    tuning: number[];
    flats?: boolean;
    beatsPerBar: number;
    bpm: number;
    title: string;
    tuningName: string;
    chords?: ChordMark[];
  },
  barsPerLine = 4
): string {
  const perBar = opts.beatsPerBar * 4;
  const lastStep = notes.reduce((m, n) => Math.max(m, n.step + n.dur), 0);
  const bars = Math.max(1, Math.ceil(lastStep / perBar));
  const names = opts.tuning.map((m, s) => {
    const l = midiName(m, opts.flats).letter;
    return s === opts.tuning.length - 1 ? l.toLowerCase() : l;
  });
  const width = Math.max(...names.map((n) => n.length));
  const cell = Math.max(2, ...notes.map((n) => noteLabel(n).length + 1));
  const byPos = new Map(notes.map((n) => [`${n.string}:${n.step}`, n]));
  const chordAt = new Map((opts.chords ?? []).map((c) => [c.step, c.name]));

  const out = [`${opts.title}`, `Tempo ${opts.bpm} BPM · ${opts.beatsPerBar}/4 · Afinación ${opts.tuningName}`, ''];
  for (let b0 = 0; b0 < bars; b0 += barsPerLine) {
    if (chordAt.size) {
      // Cifrado alineado con la columna de la casilla donde empieza cada acorde
      const chars: string[] = [];
      for (let b = b0; b < Math.min(bars, b0 + barsPerLine); b++) {
        for (let k = 0; k < perBar; k++) {
          const name = chordAt.get(b * perBar + k);
          if (!name) continue;
          const col = width + 1 + (b - b0) * (perBar * cell + 1) + k * cell;
          for (let i = 0; i < name.length; i++) chars[col + i] = name[i];
        }
      }
      if (chars.length) out.push(Array.from(chars, (c) => c ?? ' ').join(''));
    }
    for (let s = opts.tuning.length - 1; s >= 0; s--) {
      let line = names[s].padEnd(width) + '|';
      for (let b = b0; b < Math.min(bars, b0 + barsPerLine); b++) {
        for (let k = 0; k < perBar; k++) {
          const n = byPos.get(`${s}:${b * perBar + k}`);
          line += n ? noteLabel(n).padEnd(cell, '-') : '-'.repeat(cell);
        }
        line += '|';
      }
      out.push(line);
    }
    out.push('');
  }
  if (notes.some((n) => n.tech)) out.push('h: hammer-on · p: pull-off · / \\: slide · b: bend (hasta el traste indicado) · ~: vibrato');
  return out.join('\n');
}
