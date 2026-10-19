import { EffectChain } from './chain';
import { detectPitch } from './pitch';

export type ChannelMode = 'left' | 'right' | 'stereo';
export type RecordSource = 'wet' | 'dry';

export interface LatencyInfo {
  sampleRate: number;
  outputMs: number;
  inputMs: number | null;
}

export interface Level {
  peakDb: number;
  rmsDb: number;
}

const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/**
 * Grafo de audio:
 *
 *  entrada ─► splitter ─► (canal elegido) ─► ganancia ─┬─► medidor
 *                                                    ├─► afinador
 *                                                    ├─► (captura en seco)
 *                                                    └─► pedalera ─┬─► monitor ─► salida
 *                                                                  └─► (captura con efectos)
 *
 * La captura (worklet) se conecta a la señal seca o a la de la pedalera según la opción elegida.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private inputGain!: GainNode;
  private monitorGain!: GainNode;
  private meter!: AnalyserNode;
  private tuner!: AnalyserNode;
  private capture!: AudioWorkletNode;
  chain: EffectChain | null = null;
  private recordSource: RecordSource = 'wet';
  private meterBuf = new Float32Array(2048);
  private tunerBuf = new Float32Array(4096);
  private channelMode: ChannelMode = 'left';
  private chunks: Float32Array[][] = [];
  private onStopped: (() => void) | null = null;

  private async init() {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const base = import.meta.env.BASE_URL;
    await Promise.all([
      ctx.audioWorklet.addModule(`${base}worklets/capture-processor.js`),
      ctx.audioWorklet.addModule(`${base}worklets/gate-processor.js`)
    ]);

    this.inputGain = new GainNode(ctx, { gain: 1 });
    this.monitorGain = new GainNode(ctx, { gain: 0 });
    this.meter = new AnalyserNode(ctx, { fftSize: 2048 });
    this.tuner = new AnalyserNode(ctx, { fftSize: 4096 });
    this.capture = new AudioWorkletNode(ctx, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });
    const silent = new GainNode(ctx, { gain: 0 });

    this.inputGain.connect(this.meter);
    this.inputGain.connect(this.tuner);
    const chain = new EffectChain(ctx);
    this.inputGain.connect(chain.input);
    chain.output.connect(this.monitorGain).connect(ctx.destination);
    this.chain = chain;
    // El worklet necesita estar conectado al destino para que el navegador lo procese
    this.capture.connect(silent).connect(ctx.destination);

    this.capture.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'chunk') this.chunks.push(e.data.channels);
      else if (e.data.type === 'stopped') {
        this.onStopped?.();
        this.onStopped = null;
      }
    };
    this.ctx = ctx;
    this.setRecordSource(this.recordSource);
  }

  /** Graba la salida de la pedalera (estéreo) o la señal de la guitarra sin efectos. */
  setRecordSource(source: RecordSource) {
    this.recordSource = source;
    if (!this.chain) return;
    for (const node of [this.inputGain, this.chain.output]) {
      try {
        node.disconnect(this.capture);
      } catch {
        /* no estaba conectado */
      }
    }
    if (source === 'wet') {
      this.capture.channelCount = 2;
      this.capture.channelCountMode = 'explicit';
      this.chain.output.connect(this.capture);
    } else {
      this.capture.channelCountMode = 'max';
      this.inputGain.connect(this.capture);
    }
  }

  /** Abre una entrada de audio sin el procesado de voz del navegador. */
  async openInput(deviceId?: string): Promise<MediaTrackSettings> {
    await this.init();
    const ctx = this.ctx!;
    this.closeInput();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 }
      }
    });
    this.stream = stream;
    this.source = ctx.createMediaStreamSource(stream);
    this.splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    this.source.connect(this.splitter);
    this.route();
    if (ctx.state !== 'running') await ctx.resume();
    return stream.getAudioTracks()[0]?.getSettings() ?? {};
  }

  closeInput() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.splitter?.disconnect();
    this.stream = null;
    this.source = null;
    this.splitter = null;
  }

  setChannelMode(mode: ChannelMode) {
    this.channelMode = mode;
    this.route();
  }

  private route() {
    if (!this.source || !this.splitter) return;
    try {
      this.source.disconnect(this.inputGain);
    } catch {
      /* no estaba conectado */
    }
    this.splitter.disconnect();
    if (this.channelMode === 'stereo') this.source.connect(this.inputGain);
    else this.splitter.connect(this.inputGain, this.channelMode === 'left' ? 0 : 1);
  }

  setInputGainDb(db: number) {
    if (!this.ctx) return;
    this.inputGain.gain.setTargetAtTime(10 ** (db / 20), this.ctx.currentTime, 0.01);
  }

  setMonitor(on: boolean, volume: number) {
    if (!this.ctx) return;
    this.monitorGain.gain.setTargetAtTime(on ? volume : 0, this.ctx.currentTime, 0.02);
  }

  get canChooseOutput(): boolean {
    return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
  }

  async setOutputDevice(deviceId: string) {
    if (!this.ctx || !this.canChooseOutput) return;
    await (this.ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(deviceId);
  }

  readLevel(): Level {
    if (!this.ctx) return { peakDb: -Infinity, rmsDb: -Infinity };
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < this.meterBuf.length; i++) {
      const s = this.meterBuf[i];
      const a = Math.abs(s);
      if (a > peak) peak = a;
      sum += s * s;
    }
    return { peakDb: toDb(peak), rmsDb: toDb(Math.sqrt(sum / this.meterBuf.length)) };
  }

  readPitch(): number | null {
    if (!this.ctx) return null;
    this.tuner.getFloatTimeDomainData(this.tunerBuf);
    return detectPitch(this.tunerBuf, this.ctx.sampleRate);
  }

  latency(): LatencyInfo | null {
    if (!this.ctx) return null;
    const track = this.stream?.getAudioTracks()[0];
    const inLat = (track?.getSettings() as MediaTrackSettings & { latency?: number })?.latency;
    return {
      sampleRate: this.ctx.sampleRate,
      outputMs: (this.ctx.baseLatency + (this.ctx.outputLatency || 0)) * 1000,
      inputMs: typeof inLat === 'number' ? inLat * 1000 : null
    };
  }

  startRecording() {
    this.chunks = [];
    this.capture.port.postMessage({ cmd: 'start' });
  }

  async stopRecording(): Promise<{ channels: Float32Array[]; sampleRate: number }> {
    const done = new Promise<void>((resolve) => (this.onStopped = resolve));
    this.capture.port.postMessage({ cmd: 'stop' });
    await done;
    const chunks = this.chunks;
    this.chunks = [];
    const nch = chunks[0]?.length ?? 1;
    const total = chunks.reduce((n, c) => n + c[0].length, 0);
    const channels = Array.from({ length: nch }, () => new Float32Array(total));
    let offset = 0;
    for (const c of chunks) {
      for (let ch = 0; ch < nch; ch++) channels[ch].set(c[ch] ?? c[0], offset);
      offset += c[0].length;
    }
    return { channels, sampleRate: this.ctx!.sampleRate };
  }
}
