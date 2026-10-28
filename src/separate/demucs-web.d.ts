declare module 'demucs-web' {
  export interface StemPair {
    left: Float32Array;
    right: Float32Array;
  }
  export interface SeparationResult {
    drums: StemPair;
    bass: StemPair;
    other: StemPair;
    vocals: StemPair;
  }
  export interface ProgressInfo {
    progress: number;
    currentSegment: number;
    totalSegments: number;
  }
  export class DemucsProcessor {
    constructor(options: {
      ort: unknown;
      modelPath?: string;
      sessionOptions?: unknown;
      onProgress?: (info: ProgressInfo) => void;
      onLog?: (phase: string, message: string) => void;
      onDownloadProgress?: (loaded: number, total: number) => void;
    });
    loadModel(pathOrBuffer?: string | ArrayBuffer): Promise<void>;
    separate(left: Float32Array, right: Float32Array): Promise<SeparationResult>;
  }
  export const CONSTANTS: { SAMPLE_RATE: number; DEFAULT_MODEL_URL: string; TRACKS: string[] };
}
