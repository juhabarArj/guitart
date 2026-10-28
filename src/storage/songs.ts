// Canciones para practicar, guardadas tal cual (MP3, M4A…) en este navegador.
import type { PackedAudio } from './codec';
import { run } from './db';

export interface Song {
  id: string;
  name: string;
  createdAt: number;
  duration: number;
  blob: Blob;
  /** Silueta de la onda para dibujarla sin volver a decodificar */
  peaks: number[];
  bpm: number | null;
  /** Último bucle y velocidad usados con esta canción */
  loop?: { a: number; b: number; on: boolean };
  rate?: number;
  /** Segundo en que cae el primer tiempo (para alinear el metrónomo con la canción) */
  tempoOffset?: number;
  /** Instrumentos separados, comprimidos */
  stems?: { id: 'drums' | 'bass' | 'vocals' | 'other'; audio: PackedAudio }[];
}

export async function listSongs(): Promise<Song[]> {
  const all = await run<Song[]>('songs', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export const saveSong = (s: Song) => run('songs', 'readwrite', (st) => st.put(s));
export const deleteSong = (id: string) => run('songs', 'readwrite', (s) => s.delete(id));
