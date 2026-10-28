// Copia de seguridad completa en un solo archivo JSON: ajustes, presets, IR y, opcionalmente, tomas y estudio.
import { run, type StoreName } from './db';

const LS_PREFIX = 'guitart:';

interface BackupFile {
  app: 'guitart';
  kind: 'backup';
  version: 1;
  createdAt: number;
  settings: Record<string, string>;
  stores: Partial<Record<StoreName, unknown[]>>;
}

async function blobToData(b: Blob) {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
  return { __blob: url };
}

async function dataToBlob(v: { __blob: string }) {
  return (await fetch(v.__blob)).blob();
}

/** Recorre un objeto convirtiendo los Blob a texto (o al revés al importar). */
async function mapBlobs(value: unknown, toText: boolean): Promise<unknown> {
  if (toText && value instanceof Blob) return blobToData(value);
  if (!toText && value && typeof value === 'object' && '__blob' in value) return dataToBlob(value as { __blob: string });
  if (Array.isArray(value)) return Promise.all(value.map((v) => mapBlobs(v, toText)));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await mapBlobs(v, toText);
    return out;
  }
  return value;
}

export async function exportBackup(includeAudio: boolean): Promise<Blob> {
  const settings: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith(LS_PREFIX)) settings[k] = localStorage.getItem(k)!;
  }
  const names: StoreName[] = includeAudio ? ['presets', 'irs', 'recordings', 'studio', 'songs'] : ['presets', 'irs'];
  const stores: BackupFile['stores'] = {};
  for (const n of names) stores[n] = (await mapBlobs(await run<unknown[]>(n, 'readonly', (s) => s.getAll()), true)) as unknown[];
  const file: BackupFile = { app: 'guitart', kind: 'backup', version: 1, createdAt: Date.now(), settings, stores };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export interface BackupSummary {
  file: BackupFile;
  counts: Record<string, number>;
}

export function readBackup(text: string): BackupSummary {
  const file = JSON.parse(text) as BackupFile;
  if (file?.app !== 'guitart' || file.kind !== 'backup') throw new Error('Este archivo no es una copia de seguridad de Guitart.');
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(file.stores ?? {})) counts[k] = Array.isArray(v) ? v.length : 0;
  return { file, counts };
}

/** Restaura: sustituye los ajustes y añade o reemplaza (por id) presets, IR, tomas y el proyecto. */
export async function restoreBackup(file: BackupFile) {
  for (const [k, v] of Object.entries(file.settings ?? {})) if (k.startsWith(LS_PREFIX)) localStorage.setItem(k, v);
  for (const [name, items] of Object.entries(file.stores ?? {}) as [StoreName, unknown[]][]) {
    for (const item of items ?? []) {
      const value = await mapBlobs(item, false);
      await run(name, 'readwrite', (s) => s.put(value));
    }
  }
}
