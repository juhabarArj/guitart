// Sonidos de batería y metrónomo generados por código, y patrones de ritmo.

export type DrumVoice = 'kick' | 'snare' | 'hat' | 'open';
export const VOICES: { id: DrumVoice; name: string }[] = [
  { id: 'kick', name: 'Bombo' },
  { id: 'snare', name: 'Caja' },
  { id: 'hat', name: 'Charles' },
  { id: 'open', name: 'Charles abierto' }
];

export interface DrumPattern {
  id: string;
  name: string;
  beatsPerBar: number;
  swing: number;
  /** Una casilla por semicorchea: 0 vacía, 0.5 suave, 1 fuerte */
  steps: Record<DrumVoice, number[]>;
}

function render(ctx: BaseAudioContext, seconds: number, fn: (t: number, noise: number) => number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.round(sr * seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = fn(i / sr, Math.random() * 2 - 1);
  return buf;
}

/** Filtro paso alto simple aplicado a un buffer (para charles y caja). */
function highpass(buf: AudioBuffer, amount: number) {
  const d = buf.getChannelData(0);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < d.length; i++) {
    const y = amount * (prevY + d[i] - prevX);
    prevX = d[i];
    prevY = y;
    d[i] = y;
  }
  return buf;
}

export function makeSamples(ctx: BaseAudioContext) {
  let phase = 0;
  const sr = ctx.sampleRate;
  const kick = render(ctx, 0.45, (t) => {
    const f = 48 + 110 * Math.exp(-t * 28);
    phase += (2 * Math.PI * f) / sr;
    return Math.sin(phase) * Math.exp(-t * 7) * 0.95 + (t < 0.004 ? 0.3 * (1 - t / 0.004) : 0);
  });
  const snare = highpass(
    render(ctx, 0.25, (t, n) => Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 25) * 0.45 + n * Math.exp(-t * 16) * 0.6),
    0.97
  );
  const hat = highpass(highpass(render(ctx, 0.07, (t, n) => n * Math.exp(-t * 55) * 0.5), 0.9), 0.9);
  const open = highpass(highpass(render(ctx, 0.4, (t, n) => n * Math.exp(-t * 7) * 0.4), 0.9), 0.9);
  const click = render(ctx, 0.03, (t) => Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-t * 90) * 0.6);
  const accent = render(ctx, 0.04, (t) => Math.sin(2 * Math.PI * 1600 * t) * Math.exp(-t * 70) * 0.8);
  return { kick, snare, hat, open, click, accent };
}

const at = (n: number, hits: Record<number, number>) => Array.from({ length: n }, (_, i) => hits[i] ?? 0);
const every = (n: number, step: number, v = 1, offset = 0) =>
  Object.fromEntries(Array.from({ length: Math.ceil((n - offset) / step) }, (_, k) => [offset + k * step, v]));

export const PATTERNS: DrumPattern[] = [
  {
    id: 'rock',
    name: 'Rock',
    beatsPerBar: 4,
    swing: 0,
    steps: { kick: at(16, { 0: 1, 8: 1, 10: 1 }), snare: at(16, { 4: 1, 12: 1 }), hat: at(16, every(16, 2)), open: at(16, {}) }
  },
  {
    id: 'pop',
    name: 'Pop',
    beatsPerBar: 4,
    swing: 0,
    steps: {
      kick: at(16, { 0: 1, 6: 0.5, 8: 1 }),
      snare: at(16, { 4: 1, 12: 1 }),
      hat: at(16, { ...every(16, 2), 14: 0 }),
      open: at(16, { 14: 0.5 })
    }
  },
  {
    id: 'funk',
    name: 'Funk',
    beatsPerBar: 4,
    swing: 0,
    steps: {
      kick: at(16, { 0: 1, 3: 0.5, 6: 1, 10: 1 }),
      snare: at(16, { 4: 1, 7: 0.5, 9: 0.5, 12: 1 }),
      hat: at(16, { ...every(16, 1, 0.5), ...every(16, 2) }),
      open: at(16, {})
    }
  },
  {
    id: 'ballad',
    name: 'Balada',
    beatsPerBar: 4,
    swing: 0,
    steps: { kick: at(16, { 0: 1, 10: 0.5 }), snare: at(16, { 8: 1 }), hat: at(16, every(16, 2, 0.5)), open: at(16, {}) }
  },
  {
    id: 'shuffle',
    name: 'Shuffle / blues',
    beatsPerBar: 4,
    swing: 1,
    steps: { kick: at(16, { 0: 1, 8: 1 }), snare: at(16, { 4: 1, 12: 1 }), hat: at(16, every(16, 2)), open: at(16, {}) }
  },
  {
    id: 'waltz',
    name: 'Vals (3/4)',
    beatsPerBar: 3,
    swing: 0,
    steps: { kick: at(12, { 0: 1 }), snare: at(12, { 4: 0.5, 8: 0.5 }), hat: at(12, every(12, 4)), open: at(12, {}) }
  }
];

/** Ajusta la longitud del patrón a otro compás repitiendo desde el principio. */
export function resizeSteps(steps: Record<DrumVoice, number[]>, beatsPerBar: number): Record<DrumVoice, number[]> {
  const n = beatsPerBar * 4;
  const out = {} as Record<DrumVoice, number[]>;
  for (const v of VOICES) {
    const src = steps[v.id] ?? [];
    out[v.id] = Array.from({ length: n }, (_, i) => (src.length ? src[i % src.length] : 0));
  }
  return out;
}
