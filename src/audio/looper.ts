export type LooperState = 'empty' | 'armed' | 'recording' | 'playing' | 'overdub' | 'stopped';

export interface LooperStatus {
  state: LooperState;
  pos: number;
  len: number;
  layers: number;
  canUndo: boolean;
  pending: string | null;
  recorded: number;
  sampleRate: number;
}

type Listener = (s: LooperStatus) => void;

const EMPTY: LooperStatus = { state: 'empty', pos: 0, len: 0, layers: 0, canUndo: false, pending: null, recorded: 0, sampleRate: 48000 };

/** Envoltorio del worklet del looper. Sobrevive a las reconstrucciones del motor (el bucle se vacía). */
export class Looper {
  private node: AudioWorkletNode | null = null;
  private out: GainNode | null = null;
  private ctx: AudioContext | null = null;
  private listeners = new Set<Listener>();
  private latencyMs = 0;
  private volume = 1;
  status: LooperStatus = EMPTY;
  output: GainNode | null = null;

  attach(ctx: AudioContext, input: AudioNode, destination: AudioNode) {
    this.ctx = ctx;
    this.node = new AudioWorkletNode(ctx, 'looper-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit'
    });
    this.out = new GainNode(ctx, { gain: this.volume });
    input.connect(this.node);
    this.node.connect(this.out).connect(destination);
    this.output = this.out;
    this.node.port.onmessage = (e) => {
      this.status = { ...e.data, sampleRate: ctx.sampleRate };
      this.listeners.forEach((l) => l(this.status));
    };
    this.setLatency(this.latencyMs);
    this.status = { ...EMPTY, sampleRate: ctx.sampleRate };
    this.listeners.forEach((l) => l(this.status));
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.status);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Envía una orden, opcionalmente programada para un instante del contexto (s). */
  send(cmd: 'rec' | 'play' | 'stop' | 'undo' | 'clear', at?: number) {
    if (!this.node || !this.ctx) return;
    this.node.port.postMessage({ cmd, at: at != null ? Math.round(at * this.ctx.sampleRate) : undefined });
  }

  setLatency(ms: number) {
    this.latencyMs = ms;
    if (this.node && this.ctx) this.node.port.postMessage({ cmd: 'latency', frames: (ms / 1000) * this.ctx.sampleRate });
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
}
