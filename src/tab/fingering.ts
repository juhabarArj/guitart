// Elección de cuerda y traste para notas sueltas y acordes: busca la digitación con menos
// desplazamiento de la mano (Viterbi sobre grupos de notas simultáneas).
import type { RawNote, Technique } from './transcribe';

export interface TabNote {
  id: string;
  /** Posición y duración en semicorcheas desde el inicio del compás 1 */
  step: number;
  dur: number;
  midi: number;
  /** 0 = 6.ª cuerda (la más grave) … 5 = 1.ª */
  string: number;
  fret: number;
  tech?: Technique;
}

export const MAX_FRET = 22;
const MAX_SPAN = 4;

type Pos = { string: number; fret: number };

export function positions(midi: number, tuning: number[]): Pos[] {
  const out: Pos[] = [];
  tuning.forEach((open, s) => {
    const fret = midi - open;
    if (fret >= 0 && fret <= MAX_FRET) out.push({ string: s, fret });
  });
  return out;
}

interface Option {
  /** Posición de cada nota del grupo (null si no cabe en el acorde y se descarta) */
  pos: (Pos | null)[];
  cost: number;
  /** Traste medio de las notas pisadas (null si todo son cuerdas al aire) */
  center: number | null;
}

/** Todas las formas razonables de tocar un grupo de notas simultáneas. */
function groupOptions(midis: number[], tuning: number[], limit = 12, needsFret: boolean[] = []): Option[] {
  // Un bend o un vibrato no se pueden hacer en una cuerda al aire
  const cands = midis.map((m, i) => positions(m, tuning).filter((p) => !needsFret[i] || p.fret > 0));
  const found: Option[] = [];
  const pick: (Pos | null)[] = [];
  const used = new Set<number>();
  const search = (i: number, drops: number) => {
    if (i === midis.length) {
      const fretted = pick.filter((p): p is Pos => !!p && p.fret > 0).map((p) => p.fret);
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
      const center = fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : null;
      const cost =
        drops * 4 + span * 0.3 + (center ?? 0) * 0.04 + fretted.filter((f) => f > 12).length * 0.4;
      found.push({ pos: [...pick], cost, center });
      return;
    }
    for (const p of cands[i]) {
      if (used.has(p.string)) continue;
      const fretted = pick.filter((q): q is Pos => !!q && q.fret > 0).map((q) => q.fret);
      if (p.fret > 0 && fretted.length && Math.max(...fretted, p.fret) - Math.min(...fretted, p.fret) > MAX_SPAN) continue;
      used.add(p.string);
      pick.push(p);
      search(i + 1, drops);
      pick.pop();
      used.delete(p.string);
    }
    // Una nota que no cabe en el acorde (armónico, nota fantasma) se puede descartar, con penalización
    if (midis.length > 1) {
      pick.push(null);
      search(i + 1, drops + 1);
      pick.pop();
    }
  };
  search(0, 0);
  return found
    .filter((o) => o.pos.some((p) => p))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, limit);
}

function transition(a: Option, b: Option, legato: boolean, aSingle: Pos | null, bSingle: Pos | null) {
  let c = 0;
  if (a.center != null && b.center != null) {
    const jump = Math.abs(a.center - b.center);
    c += jump * 0.6 + (jump > 4 ? 2.5 : 0);
  }
  // Ligados y slides se tocan en la misma cuerda
  if (legato && aSingle && bSingle) c += aSingle.string === bSingle.string ? -0.8 : 1.5;
  return c;
}

/**
 * Ajusta las notas a la rejilla de semicorcheas, agrupa las simultáneas y les asigna cuerda y traste.
 * poly = false: una nota a la vez (si dos caen en la misma casilla, se queda la primera).
 */
export function quantize(raw: RawNote[], bpm: number, offset: number, tuning: number[], poly = false): TabNote[] {
  const sd = 60 / bpm / 4;
  const byStep = new Map<number, { midi: number; dur: number; tech?: Technique }[]>();
  for (const n of [...raw].sort((a, b) => a.t - b.t)) {
    const step = Math.round((n.t - offset) / sd);
    if (step < 0) continue;
    const dur = Math.max(1, Math.round((n.end - n.t) / sd));
    const list = byStep.get(step) ?? [];
    if (!poly && list.length) continue;
    if (list.some((x) => x.midi === n.midi)) continue;
    const tech: Technique = {};
    if (n.from) tech.from = n.from;
    if (n.bend) tech.bend = n.bend;
    if (n.vib) tech.vib = true;
    list.push({ midi: n.midi, dur, ...(Object.keys(tech).length ? { tech } : {}) });
    byStep.set(step, list);
  }
  const steps = [...byStep.keys()].sort((a, b) => a - b);
  const groups = steps.map((s) => byStep.get(s)!.sort((a, b) => a.midi - b.midi));

  // Viterbi sobre los grupos
  const opts = groups.map((g) =>
    groupOptions(
      g.map((x) => x.midi),
      tuning,
      12,
      g.map((x) => !!(x.tech?.bend || x.tech?.vib))
    )
  );
  const dp: number[][] = [];
  const back: number[][] = [];
  opts.forEach((os, i) => {
    dp[i] = [];
    back[i] = [];
    const legato = groups[i].length === 1 && !!groups[i][0].tech?.from;
    os.forEach((o, j) => {
      if (i === 0 || !opts[i - 1].length) {
        dp[i][j] = o.cost + (i > 0 && dp[i - 1].length ? Math.min(...dp[i - 1]) : 0);
        back[i][j] = -1;
        return;
      }
      let best = Infinity;
      let arg = 0;
      opts[i - 1].forEach((p, k) => {
        const v = dp[i - 1][k] + transition(p, o, legato, p.pos.length === 1 ? p.pos[0] : null, o.pos.length === 1 ? o.pos[0] : null);
        if (v < best) {
          best = v;
          arg = k;
        }
      });
      dp[i][j] = best + o.cost;
      back[i][j] = arg;
    });
  });
  const chosen: (Option | null)[] = new Array(groups.length).fill(null);
  let j = -1;
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!opts[i].length) {
      j = -1;
      continue;
    }
    if (j < 0) j = dp[i].indexOf(Math.min(...dp[i]));
    chosen[i] = opts[i][j];
    j = back[i][j];
  }

  const out: TabNote[] = [];
  groups.forEach((g, i) => {
    const o = chosen[i];
    if (!o) return;
    g.forEach((n, k) => {
      const p = o.pos[k];
      if (p) out.push({ id: crypto.randomUUID() as string, step: steps[i], dur: n.dur, midi: n.midi, ...p, ...(n.tech ? { tech: n.tech } : {}) });
    });
  });
  // Una nota no puede sonar sobre la siguiente de la misma cuerda; en modo de notas sueltas, tampoco sobre la siguiente nota
  for (const n of out) {
    const next = out.find((m) => m.step > n.step && (!poly || m.string === n.string));
    if (next) n.dur = Math.max(1, Math.min(n.dur, next.step - n.step));
  }
  return out;
}
