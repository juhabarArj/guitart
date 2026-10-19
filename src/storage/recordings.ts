// Grabaciones guardadas en IndexedDB, solo en este navegador.
import { run } from './db';

export interface Recording {
  id: string;
  name: string;
  createdAt: number;
  duration: number;
  sampleRate: number;
  channels: number;
  /** 'wet' con efectos, 'dry' en seco. Las tomas de la Fase 1 no lo tienen (eran en seco). */
  source?: 'wet' | 'dry';
  blob: Blob;
}

export async function listRecordings(): Promise<Recording[]> {
  const all = await run<Recording[]>('recordings', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export const saveRecording = (r: Recording) => run('recordings', 'readwrite', (s) => s.put(r));
export const deleteRecording = (id: string) => run('recordings', 'readwrite', (s) => s.delete(id));
