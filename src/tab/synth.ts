// Sonido de cuerda pulsada (Karplus-Strong) para escuchar la tablatura y las notas al editarlas.
const cache = new Map<string, AudioBuffer>();

export function pluck(ctx: BaseAudioContext, midi: number): AudioBuffer {
  const key = `${ctx.sampleRate}:${midi}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const f = 440 * 2 ** ((midi - 69) / 12);
  const period = Math.max(2, Math.round(sr / f));
  const len = Math.round(sr * 1.6);
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
  const ring = Float32Array.from({ length: period }, () => Math.random() * 2 - 1);
  const decay = midi < 50 ? 0.998 : 0.996;
  for (let i = 0, k = 0; i < len; i++, k = (k + 1) % period) {
    const next = (k + 1) % period;
    out[i] = ring[k] * 0.35;
    ring[k] = decay * 0.5 * (ring[k] + ring[next]);
  }
  cache.set(key, buf);
  return buf;
}

/** Toca una nota en "at" y la apaga suavemente tras "seconds". */
export function playNote(ctx: AudioContext, dest: AudioNode, midi: number, at: number, seconds: number) {
  const src = new AudioBufferSourceNode(ctx, { buffer: pluck(ctx, midi) });
  const g = new GainNode(ctx, { gain: 1 });
  src.connect(g).connect(dest);
  src.start(at);
  g.gain.setTargetAtTime(0, at + seconds, 0.03);
  src.stop(at + seconds + 0.3);
  return src;
}
