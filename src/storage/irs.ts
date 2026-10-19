// Respuestas al impulso (IR) de altavoz cargadas por el usuario, guardadas en este navegador.
import { run } from './db';

export interface StoredIr {
  id: string;
  name: string;
  createdAt: number;
  blob: Blob;
}

export const MAX_IR_BYTES = 5 * 1024 * 1024;
/** Las IR de pantalla útiles duran menos de medio segundo; recortar ahorra CPU. */
export const MAX_IR_SECONDS = 1;

export async function listIrs(): Promise<StoredIr[]> {
  const all = await run<StoredIr[]>('irs', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export const getIr = (id: string) => run<StoredIr | undefined>('irs', 'readonly', (s) => s.get(id));
export const saveIr = (ir: StoredIr) => run('irs', 'readwrite', (s) => s.put(ir));
export const deleteIr = (id: string) => run('irs', 'readwrite', (s) => s.delete(id));

/** Decodifica un WAV y lo recorta a MAX_IR_SECONDS. */
export async function decodeIr(ctx: BaseAudioContext, blob: Blob): Promise<AudioBuffer> {
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  const max = Math.round(MAX_IR_SECONDS * decoded.sampleRate);
  if (decoded.length <= max) return decoded;
  const trimmed = ctx.createBuffer(decoded.numberOfChannels, max, decoded.sampleRate);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const data = decoded.getChannelData(c).subarray(0, max);
    // Fundido final corto para que el recorte no produzca un clic
    const fade = Math.min(256, max);
    const out = new Float32Array(data);
    for (let i = 0; i < fade; i++) out[max - 1 - i] *= i / fade;
    trimmed.copyToChannel(out, c);
  }
  return trimmed;
}
