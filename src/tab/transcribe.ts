// Transcripción monofónica: ataques (flujo espectral) + tono (YIN) → notas con tiempo, duración y altura.
import { detectPitch } from '../audio/pitch';

/** Cómo se llega a la nota sin púa desde la anterior: hammer-on, pull-off, slide arriba o abajo */
export type Legato = 'h' | 'p' | '/' | '\\';

export interface Technique {
  from?: Legato;
  /** Bend en semitonos (1 = medio tono, 2 = un tono) */
  bend?: number;
  vib?: boolean;
}

export interface RawNote extends Technique {
  /** Inicio y final en segundos */
  t: number;
  end: number;
  /** Nota MIDI redondeada y desviación media en cents */
  midi: number;
  cents: number;
}

export interface TranscribeOptions {
  /** 0–1: más alto detecta ataques más suaves (y también más ruido) */
  sensitivity: number;
  a4: number;
  /** Rango de notas aceptado (guitarra: Do2 a Mi6 aprox.) */
  minMidi: number;
  maxMidi: number;
}

export const DEFAULT_TRANSCRIBE: TranscribeOptions = { sensitivity: 0.5, a4: 440, minMidi: 34, maxMidi: 90 };

const N = 1024;
const HOP = 256;

/** FFT radix-2 in situ (re, im). */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Mezcla a mono y normaliza a pico 0,9 (las tomas flojas también se analizan bien). */
export function toMono(channels: Float32Array[]): Float32Array {
  const len = channels[0]?.length ?? 0;
  const out = new Float32Array(len);
  for (const c of channels) for (let i = 0; i < len; i++) out[i] += c[i] / channels.length;
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < len; i++) out[i] *= 0.9 / peak;
  return out;
}

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

export interface OnsetAnalysis {
  frames: number;
  /** Tramas (de HOP muestras) donde empieza un sonido */
  onsets: number[];
  rms: Float32Array;
  maxRms: number;
}

/** Ataques por flujo espectral con umbral adaptativo (sirve para notas y para el tempo de una canción). */
export async function analyzeOnsets(
  x: Float32Array,
  sr: number,
  sensitivity: number,
  onProgress?: (p: number) => void
): Promise<OnsetAnalysis> {
  const frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const maxBin = Math.min(N / 2, Math.round((6000 / sr) * N));
  const flux = new Float32Array(frames);
  const rms = new Float32Array(frames);
  let prev = new Float32Array(maxBin);
  const re = new Float32Array(N);
  const im = new Float32Array(N);

  // 1. Flujo espectral y energía por trama
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    let e = 0;
    for (let i = 0; i < N; i++) {
      const s = x[o + i];
      e += s * s;
      re[i] = s * win[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(e / N);
    fft(re, im);
    const mag = new Float32Array(maxBin);
    let fl = 0;
    for (let k = 1; k < maxBin; k++) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = mag[k] - prev[k];
      if (d > 0) fl += d;
    }
    flux[f] = fl;
    prev = mag;
    if (f % 400 === 0) {
      onProgress?.(0.5 * (f / frames));
      await yieldToUi();
    }
  }

  // 2. Picos del flujo por encima de un umbral adaptativo
  let maxFlux = 0;
  let maxRms = 0;
  for (let f = 0; f < frames; f++) {
    maxFlux = Math.max(maxFlux, flux[f]);
    maxRms = Math.max(maxRms, rms[f]);
  }
  const w = 12;
  const delta = 0.2 - 0.17 * sensitivity; // proporción del máximo
  const minGap = Math.round((0.06 * sr) / HOP);
  const onsets: number[] = [];
  for (let f = 0; f < frames - 1; f++) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, f - w); k <= Math.min(frames - 1, f + w); k++) {
      sum += flux[k];
      n++;
    }
    const thr = (sum / n) * 1.3 + delta * maxFlux;
    const peak = flux[f] > thr && flux[f] >= (f > 0 ? flux[f - 1] : 0) && flux[f] > flux[f + 1];
    const loud = rms[Math.min(frames - 1, f + 2)] > maxRms * 0.03;
    if (peak && loud && (!onsets.length || f - onsets[onsets.length - 1] >= minGap)) onsets.push(f);
  }

  return { frames, onsets, rms, maxRms };
}

/** Instantes (s) de los ataques. */
export const onsetSeconds = (a: OnsetAnalysis, sr: number) => a.onsets.map((f) => (f * HOP + HOP) / sr);

export async function transcribe(
  x: Float32Array,
  sr: number,
  opts: TranscribeOptions = DEFAULT_TRANSCRIBE,
  onProgress?: (p: number) => void
): Promise<RawNote[]> {
  const { frames, onsets, rms, maxRms } = await analyzeOnsets(x, sr, opts.sensitivity, onProgress);

  // 3. Solo cuentan como púa los ataques en los que sube la energía (un hammer-on o un slide no la suben)
  const attacks: number[] = [];
  const onsetTimes = onsets.map((f) => Math.max(0, (f * HOP + HOP) / sr));
  for (const f of onsets) {
    const before = Math.max(1e-6, rms[Math.max(0, f - 3)]);
    let after = 0;
    for (let k = f; k < Math.min(frames, f + 4); k++) after = Math.max(after, rms[k]);
    if (after / before >= 1.3) attacks.push(Math.max(0, (f * HOP + N / 2 - (N / 2 - HOP)) / sr));
  }

  // 4. Curva de tono continua (una lectura cada 20 ms)
  const toMidi = (hz: number) => 69 + 12 * Math.log2(hz / opts.a4);
  const pitchWin = 2048;
  const pitchHop = Math.round(0.02 * sr);
  const gate = maxRms * 0.03;
  const track: { t: number; m: number | null }[] = [];
  for (let s = 0, n = 0; s + pitchWin < x.length; s += pitchHop, n++) {
    const f = Math.min(frames - 1, Math.floor((s + pitchWin / 2) / HOP));
    const hz = rms[f] > gate ? detectPitch(x.subarray(s, s + pitchWin), sr) : null;
    track.push({ t: (s + pitchWin / 2) / sr, m: hz ? toMidi(hz) : null });
    if (n % 150 === 0) {
      onProgress?.(0.5 + 0.45 * (s / x.length));
      await yieldToUi();
    }
  }

  // 5. Tramos de tono estable; un ataque de púa o un salto de tono empieza tramo nuevo
  interface Region {
    start: number;
    attackAt: number | null;
    values: number[];
    lastT: number;
  }
  const median = (v: number[]) => [...v].sort((p, q) => p - q)[v.length >> 1];
  const regions: (Region | null)[] = []; // null = silencio
  let cur: Region | null = null;
  let ai = 0;
  for (const smp of track) {
    let attackAt: number | null = null;
    while (ai < attacks.length && attacks[ai] <= smp.t - 0.02) attackAt = attacks[ai++];
    if (smp.m == null) {
      if (cur) regions.push(cur, null);
      cur = null;
      continue;
    }
    const breakHere = attackAt != null || !cur || Math.abs(smp.m - median(cur.values)) >= 0.6;
    if (breakHere) {
      if (cur) regions.push(cur);
      // Sin púa clara, el inicio se ajusta al ataque espectral más cercano (si lo hay) y no a la lectura de tono
      const near = onsetTimes.filter((t) => t <= smp.t && t >= smp.t - 0.06).pop();
      cur = { start: attackAt ?? near ?? smp.t - 0.023, attackAt, values: [], lastT: smp.t };
    }
    cur!.values.push(smp.m);
    cur!.lastT = smp.t;
  }
  if (cur) regions.push(cur);

  // 6. Notas: tramos largos (o con púa); entre ellos se clasifica la transición
  const notes: RawNote[] = [];
  let trans: number[] = [];
  let prevLast: { t: number; m: number } | null = null;
  for (const r of regions) {
    if (!r) {
      trans = [];
      prevLast = null;
      continue;
    }
    // Un tramo que sube o baja de forma continua (parte de un bend o de un slide) no es una nota
    const v = r.values;
    const ds = v.slice(1).map((x, i) => x - v[i]);
    const drifting =
      v.length >= 3 &&
      Math.max(...v) - Math.min(...v) >= 0.45 &&
      Math.max(ds.filter((d) => d > 0.02).length, ds.filter((d) => d < -0.02).length) / ds.length >= 0.8;
    const long = !drifting && (v.length >= 5 || (r.attackAt != null && v.length >= 3));
    if (!long) {
      if (r.attackAt != null) trans = [];
      trans.push(...r.values);
      continue;
    }
    const med = median(r.values);
    const midi = Math.round(med);
    const prev = notes[notes.length - 1];
    const legato = r.attackAt == null && prev && prevLast && r.start - prevLast.t < 0.15;
    if (legato && prev) {
      const seq = [prevLast!.m, ...trans, r.values[0]];
      const deltas = seq.slice(1).map((v, i) => v - seq[i]);
      const smooth =
        deltas.length >= 3 && deltas.filter((d) => Math.abs(d) > 0.04 && Math.abs(d) < 0.45).length / deltas.length >= 0.6;
      const base = prev.midi;
      const interval = midi - base;
      // Bend (subida continua de 1 a 3 semitonos), mantenerlo o soltarlo: sigue siendo la misma nota
      if ((smooth && interval >= 1 && interval <= 3) || (prev.bend && (interval === prev.bend || interval === 0))) {
        if (interval > 0) prev.bend = Math.max(prev.bend ?? 0, interval);
        prev.end = r.lastT + 0.01;
        prevLast = { t: r.lastT, m: r.values[r.values.length - 1] };
        trans = [];
        continue;
      }
      const stepInt = midi - Math.round(prevLast!.m);
      // Slide: pasa por trastes intermedios (al menos dos lecturas en medio); si no, es un ligado
      const between = trans.filter((x) => {
        const k = Math.round(x);
        return (k - Math.round(prevLast!.m)) * (k - midi) < 0;
      }).length;
      const from: Legato =
        Math.abs(stepInt) >= 2 && ((between >= 1 && trans.length >= 2) || smooth)
          ? stepInt > 0
            ? '/'
            : '\\'
          : stepInt > 0
            ? 'h'
            : 'p';
      prev.end = Math.min(prev.end, r.start);
      notes.push(makeNote(r, med, midi, from));
    } else notes.push(makeNote(r, med, midi));
    prevLast = { t: r.lastT, m: r.values[r.values.length - 1] };
    trans = [];
  }

  function makeNote(r: Region, med: number, midi: number, from?: Legato): RawNote {
    // Vibrato: el tono oscila alrededor de la nota varias veces
    // (se ignoran las dos primeras lecturas, que recogen el ataque, y las desviaciones mínimas)
    const body = r.values.slice(2);
    let crossings = 0;
    let dev = 0;
    let side = 0;
    for (const v of body) {
      dev += (v - med) ** 2;
      const s = v - med > 0.06 ? 1 : v - med < -0.06 ? -1 : 0;
      if (s && side && s !== side) crossings++;
      if (s) side = s;
    }
    const vib = body.length >= 8 && Math.sqrt(dev / body.length) > 0.12 && crossings >= 4;
    return {
      t: r.start,
      end: r.lastT + 0.01,
      midi,
      cents: Math.round((med - midi) * 100),
      ...(from ? { from } : {}),
      ...(vib ? { vib } : {})
    };
  }

  const inRange = notes.filter((n) => n.midi >= opts.minMidi && n.midi <= opts.maxMidi && n.end - n.t >= 0.04);
  notes.length = 0;
  notes.push(...inRange);
  onProgress?.(1);
  return notes;
}

/** Estima el tempo buscando la rejilla de corcheas que mejor encaja con los ataques. */
export function estimateBpm(notes: RawNote[]): number {
  return estimateBpmFromTimes(notes.map((n) => n.t));
}

export function estimateBpmFromTimes(input: number[]): number {
  // Las notas de un mismo rasgueo (separadas unos milisegundos) cuentan como un solo ataque
  const times: number[] = [];
  for (const t of [...input].sort((a, b) => a - b)) if (!times.length || t - times[times.length - 1] > 0.05) times.push(t);
  if (times.length < 4) return 100;
  const t0 = times[0];
  let best = 100;
  let bestScore = Infinity;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const sd = 60 / bpm / 2;
    let err = 0;
    // Error medido en segundos (no en fracción de rejilla), para no castigar los tempos rápidos
    for (const t of times) {
      const q = (t - t0) / sd;
      err += Math.abs(q - Math.round(q)) * sd;
    }
    // Ligera preferencia por tempos medios para evitar el doble o la mitad
    const score = err / times.length + Math.abs(bpm - 110) / 20000;
    if (score < bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  return Math.round(best);
}
