// Sonido de cuerda pulsada (Karplus-Strong) para escuchar la tablatura y las notas al editarlas.
import type { Technique } from './transcribe';

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

/**
 * Toca una nota en "at" y la apaga suavemente tras "seconds".
 * Con técnica: bend y vibrato mueven la afinación; los ligados suenan más suaves; los slides llegan deslizando.
 */
export function playNote(
  ctx: AudioContext,
  dest: AudioNode,
  midi: number,
  at: number,
  seconds: number,
  tech?: Technique,
  prevMidi?: number
) {
  const src = new AudioBufferSourceNode(ctx, { buffer: pluck(ctx, midi) });
  const g = new GainNode(ctx, { gain: tech?.from ? 0.6 : 1 });
  src.connect(g).connect(dest);
  if (tech?.bend) {
    src.detune.setValueAtTime(0, at);
    src.detune.linearRampToValueAtTime(tech.bend * 100, at + Math.min(0.2, seconds * 0.5));
  }
  if ((tech?.from === '/' || tech?.from === '\\') && prevMidi != null) {
    src.detune.setValueAtTime((prevMidi - midi) * 100, at);
    src.detune.linearRampToValueAtTime(0, at + 0.08);
  }
  if (tech?.vib) {
    const lfo = new OscillatorNode(ctx, { frequency: 5.5 });
    const depth = new GainNode(ctx, { gain: 25 });
    lfo.connect(depth).connect(src.detune);
    lfo.start(at + 0.1);
    lfo.stop(at + seconds + 0.3);
  }
  src.start(at);
  g.gain.setTargetAtTime(0, at + seconds, 0.03);
  src.stop(at + seconds + 0.3);
  return src;
}
