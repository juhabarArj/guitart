// Tablatura de texto (la de números que se copia y pega).
import { midiName } from '../audio/pitch';
import type { TabNote } from './fingering';

export function toAscii(
  notes: TabNote[],
  opts: { tuning: number[]; flats?: boolean; beatsPerBar: number; bpm: number; title: string; tuningName: string },
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
  const cell = notes.some((n) => n.fret >= 10) ? 3 : 2;
  const byPos = new Map(notes.map((n) => [`${n.string}:${n.step}`, n]));

  const out = [`${opts.title}`, `Tempo ${opts.bpm} BPM · ${opts.beatsPerBar}/4 · Afinación ${opts.tuningName}`, ''];
  for (let b0 = 0; b0 < bars; b0 += barsPerLine) {
    for (let s = opts.tuning.length - 1; s >= 0; s--) {
      let line = names[s].padEnd(width) + '|';
      for (let b = b0; b < Math.min(bars, b0 + barsPerLine); b++) {
        for (let k = 0; k < perBar; k++) {
          const n = byPos.get(`${s}:${b * perBar + k}`);
          line += n ? String(n.fret).padEnd(cell, '-') : '-'.repeat(cell);
        }
        line += '|';
      }
      out.push(line);
    }
    out.push('');
  }
  return out.join('\n');
}
