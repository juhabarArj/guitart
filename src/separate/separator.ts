// Control de la separación de instrumentos desde la interfaz.
export const MODEL_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
export const MODEL_MB = 172;
export const SEP_RATE = 44100;

export type StemId = 'drums' | 'bass' | 'vocals' | 'other';
export interface Stem {
  id: StemId;
  left: Float32Array;
  right: Float32Array;
}

export const STEM_NAMES: Record<StemId, string> = {
  drums: 'Batería',
  bass: 'Bajo',
  vocals: 'Voz',
  other: 'Resto (guitarras, teclados…)'
};

export interface SeparatorEvents {
  onDownload?: (loaded: number, total: number, cached?: boolean) => void;
  onLog?: (message: string) => void;
  onProgress?: (progress: number, segment: number, total: number) => void;
}

export interface Backend {
  gpu: boolean;
  threads: number;
  isolated: boolean;
}

export class Separator {
  private worker: Worker | null = null;
  backend: Backend | null = null;
  events: SeparatorEvents = {};

  private ensure() {
    if (!this.worker) this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    return this.worker;
  }

  private request<T>(msg: unknown, transfer: Transferable[], until: string): Promise<T> {
    const w = this.ensure();
    return new Promise((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        const d = e.data;
        if (d.type === 'download') this.events.onDownload?.(d.loaded, d.total, d.cached);
        else if (d.type === 'log') this.events.onLog?.(d.message);
        else if (d.type === 'progress') this.events.onProgress?.(d.progress, d.currentSegment, d.totalSegments);
        else if (d.type === until) {
          w.removeEventListener('message', onMsg);
          resolve(d as T);
        } else if (d.type === 'error') {
          w.removeEventListener('message', onMsg);
          reject(new Error(d.message));
        }
      };
      w.addEventListener('message', onMsg);
      w.postMessage(msg, transfer);
    });
  }

  async isCached(): Promise<boolean> {
    const r = await this.request<{ cached: boolean }>({ cmd: 'cached', source: MODEL_URL }, [], 'cached');
    return r.cached;
  }

  /** Carga el modelo: de la caché, de Hugging Face, o de un archivo que elija el usuario. */
  async load(source: string | ArrayBuffer = MODEL_URL) {
    if (this.backend) return this.backend;
    const wasmPath = new URL(`${import.meta.env.BASE_URL}ort/`, location.href).href;
    const r = await this.request<Backend & { type: string }>(
      { cmd: 'load', source, wasmPath },
      source instanceof ArrayBuffer ? [source] : [],
      'ready'
    );
    this.backend = { gpu: r.gpu, threads: r.threads, isolated: r.isolated };
    return this.backend;
  }

  async separate(left: Float32Array, right: Float32Array): Promise<Stem[]> {
    const r = await this.request<{ stems: Stem[] }>({ cmd: 'separate', left, right }, [left.buffer, right.buffer], 'done');
    return r.stems;
  }

  /** Libera la memoria del modelo (se vuelve a cargar de la caché si hace falta). */
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.backend = null;
  }
}
