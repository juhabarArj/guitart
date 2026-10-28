// Hilo aparte para la separación de instrumentos: la interfaz sigue respondiendo mientras trabaja.
import * as ort from 'onnxruntime-web/webgpu';
import { CONSTANTS, DemucsProcessor, type SeparationResult } from 'demucs-web';

export const MODEL_URL = CONSTANTS.DEFAULT_MODEL_URL;
const CACHE = 'guitart-demucs-v1';
const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

let processor: DemucsProcessor | null = null;

async function modelBuffer(source: string | ArrayBuffer): Promise<ArrayBuffer> {
  if (source instanceof ArrayBuffer) return source;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(source);
  if (hit) {
    post({ type: 'download', loaded: 1, total: 1, cached: true });
    return hit.arrayBuffer();
  }
  const res = await fetch(source);
  if (!res.ok || !res.body) throw new Error(`descarga ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 172 * 1024 * 1024;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (loaded - last > 2 * 1024 * 1024) {
      last = loaded;
      post({ type: 'download', loaded, total });
    }
  }
  const blob = new Blob(chunks as BlobPart[]);
  // Se guarda para no volver a descargarlo (si el navegador tiene espacio)
  try {
    await cache.put(source, new Response(blob, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch {
    post({ type: 'log', message: 'No hay espacio para guardar el modelo: se descargará de nuevo la próxima vez.' });
  }
  return blob.arrayBuffer();
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.cmd === 'load') {
      ort.env.wasm.wasmPaths = m.wasmPath;
      // Varios hilos solo si la página está aislada (cabeceras COOP/COEP); si no, uno
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
      let gpu = false;
      try {
        const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
        gpu = !!(nav.gpu && (await nav.gpu.requestAdapter()));
      } catch {
        gpu = false;
      }
      const buffer = await modelBuffer(m.source);
      post({ type: 'log', message: 'Preparando el modelo…' });
      processor = new DemucsProcessor({
        ort,
        onProgress: (p) => post({ type: 'progress', ...p })
      });
      await processor.loadModel(buffer);
      post({ type: 'ready', gpu, threads: ort.env.wasm.numThreads, isolated: self.crossOriginIsolated });
    } else if (m.cmd === 'separate') {
      if (!processor) throw new Error('modelo no cargado');
      const r: SeparationResult = await processor.separate(m.left, m.right);
      const out = (['drums', 'bass', 'vocals', 'other'] as const).map((k) => ({ id: k, left: r[k].left, right: r[k].right }));
      post({ type: 'done', stems: out }, out.flatMap((s) => [s.left.buffer, s.right.buffer]));
    } else if (m.cmd === 'cached') {
      const cache = await caches.open(CACHE);
      post({ type: 'cached', cached: !!(await cache.match(m.source)) });
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
