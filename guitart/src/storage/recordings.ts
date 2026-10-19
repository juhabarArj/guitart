// Grabaciones guardadas en IndexedDB, solo en este navegador.
export interface Recording {
  id: string;
  name: string;
  createdAt: number;
  duration: number;
  sampleRate: number;
  channels: number;
  blob: Blob;
}

const DB_NAME = 'guitart';
const STORE = 'recordings';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listRecordings(): Promise<Recording[]> {
  const all = await run<Recording[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export const saveRecording = (r: Recording) => run('readwrite', (s) => s.put(r));
export const deleteRecording = (id: string) => run('readwrite', (s) => s.delete(id));
