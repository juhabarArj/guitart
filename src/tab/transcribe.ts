// Transcripción monofónica: ataques (flujo espectral) + tono (YIN) → notas con tiempo, duración y altura.
import { detectPitch } from '../audio/pitch';

export interface RawNote {
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

export async function transcribe(
  x: Float32Array,
  sr: number,
  opts: TranscribeOptions = DEFAULT_TRANSCRIBE,
  onProgress?: (p: number) => void
): Promise<RawNote[]> {
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
  const delta = 0.2 - 0.17 * opts.sensitivity; // proporción del máximo
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

  // 3. Tono de cada nota, y división si el tono cambia sin nuevo ataque (ligados)
  const notes: RawNote[] = [];
  const toMidi = (hz: number) => 69 + 12 * Math.log2(hz / opts.a4);
  const pitchWin = 2048;
  const pitchHop = Math.round(0.02 * sr);
  const frameT = (f: number) => (f * HOP + N / 2) / sr;

  for (let i = 0; i < onsets.length; i++) {
    const f0 = onsets[i];
    const fNext = i + 1 < onsets.length ? onsets[i + 1] : frames;
    let peakRms = 0;
    let fEnd = fNext;
    for (let f = f0; f < fNext; f++) {
      peakRms = Math.max(peakRms, rms[f]);
      if (f > f0 + 4 && rms[f] < peakRms * 0.12) {
        fEnd = f;
        break;
      }
    }
    const start = Math.max(0, frameT(f0) - (N / 2 - HOP) / sr);
    const end = frameT(fEnd);
    const samples: { t: number; m: number }[] = [];
    for (let s = Math.round((start + 0.03) * sr); s + pitchWin < Math.min(x.length, end * sr); s += pitchHop) {
      const hz = detectPitch(x.subarray(s, s + pitchWin), sr);
      if (hz) samples.push({ t: s / sr, m: toMidi(hz) });
    }
    // Agrupa tramos de tono estable
    let segStart = start;
    let group: number[] = [];
    const flush = (segEnd: number) => {
      if (group.length < 2) return;
      const sorted = [...group].sort((a, b) => a - b);
      const med = sorted[sorted.length >> 1];
      const midi = Math.round(med);
      if (midi < opts.minMidi || midi > opts.maxMidi || segEnd - segStart < 0.04) return;
      notes.push({ t: segStart, end: segEnd, midi, cents: Math.round((med - midi) * 100) });
    };
    for (let k = 0; k < samples.length; k++) {
      const cur = Math.round(samples[k].m);
      const ref = group.length ? Math.round([...group].sort((a, b) => a - b)[group.length >> 1]) : cur;
      // Cambio estable de nota (3 lecturas seguidas): nueva nota sin ataque
      if (
        group.length >= 3 &&
        cur !== ref &&
        k + 2 < samples.length &&
        Math.round(samples[k + 1].m) === cur &&
        Math.round(samples[k + 2].m) === cur
      ) {
        flush(samples[k].t);
        segStart = samples[k].t;
        group = [];
      }
      if (cur === ref || !group.length || Math.abs(samples[k].m - ref) < 0.6) group.push(samples[k].m);
    }
    flush(end);
    if (i % 20 === 0) {
      onProgress?.(0.5 + 0.5 * (i / Math.max(1, onsets.length)));
      await yieldToUi();
    }
  }
  onProgress?.(1);
  return notes;
}

/** Estima el tempo buscando la rejilla de corcheas que mejor encaja con los ataques. */
export function estimateBpm(notes: RawNote[]): number {
  if (notes.length < 4) return 100;
  const t0 = notes[0].t;
  let best = 100;
  let bestScore = Infinity;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const sd = 60 / bpm / 2;
    let err = 0;
    for (const n of notes) {
      const q = (n.t - t0) / sd;
      err += Math.abs(q - Math.round(q));
    }
    // Ligera preferencia por tempos medios para evitar el doble o la mitad
    const score = err / notes.length + Math.abs(bpm - 110) / 4000;
    if (score < bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  return Math.round(best);
}
