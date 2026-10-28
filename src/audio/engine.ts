import { EffectChain, type BoardState } from './chain';
import { SongPlayer } from './song';
import { StudioPlayer } from './studio';
import { PATTERNS } from './drums';
import type { IrLoader } from './effects';
import { Looper } from './looper';
import { detectPitch } from './pitch';
import { Transport } from './transport';

export type ChannelMode = 'left' | 'right' | 'stereo';
/** wet: todo lo que suena · guitar: solo la guitarra con efectos · dry: guitarra sin efectos */
export type RecordSource = 'wet' | 'guitar' | 'dry';

export interface LatencyInfo {
  sampleRate: number;
  outputMs: number;
  inputMs: number | null;
}

export interface Level {
  peakDb: number;
  rmsDb: number;
}

export interface LatencyMeasurement {
  ms: number;
  clicks: number;
}

const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

function protectCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const u = ((i / (n - 1)) * 2 - 1) * 2; // dominio ±2 (la entrada se divide entre 2)
    const a = Math.abs(u);
    curve[i] = a < 0.8 ? u : Math.sign(u) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
  }
  return curve;
}

/**
 * Grafo de audio:
 *
 *  entrada ─► splitter ─► (canal elegido) ─► ganancia ─┬─► medidor
 *                                                    ├─► afinador
 *                                                    ├─► (captura en seco)
 *                                                    └─► pedalera ─► protección ─┬─► silencio de afinador ─► monitor ─► salida
 *                                                                               ├─► looper ─► salida
 *                                                                               └─► mezcla ─► (captura en modo mezcla)
 *  reloj de tempo (metrónomo y batería) ─► salida y mezcla
 *
 * El contexto de audio se crea con la frecuencia de muestreo de la interfaz para evitar remuestreos.
 * Si cambia la entrada a otra frecuencia, o el modo de latencia, el grafo se reconstruye y se
 * restaura todo el estado (canal, ganancia, escucha, salida, pedalera…).
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  chain: EffectChain | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private inputGain!: GainNode;
  private tunerMuteGain!: GainNode;
  private monitorGain!: GainNode;
  private meter!: AnalyserNode;
  private tuner!: AnalyserNode;
  private capture!: AudioWorkletNode;
  private protect!: WaveShaperNode;
  private silent!: GainNode;
  /** Todo lo que suena (guitarra con efectos, looper y ritmo): es lo que se graba en modo mezcla */
  private mixBus!: GainNode;
  readonly looper = new Looper();
  readonly studio = new StudioPlayer();
  readonly song = new SongPlayer();
  readonly transport = new Transport({
    bpm: 100,
    beatsPerBar: 4,
    metronome: true,
    metronomeVolume: 0.6,
    drums: false,
    drumVolume: 0.7,
    swing: 0,
    steps: PATTERNS[0].steps
  });
  private meterBuf = new Float32Array(2048);
  private tunerBuf = new Float32Array(4096);
  private chunks: Float32Array[][] = [];
  private onStopped: (() => void) | null = null;

  // Estado que sobrevive a una reconstrucción del grafo
  private state = {
    channelMode: 'left' as ChannelMode,
    gainDb: 0,
    monitorOn: false,
    monitorVolume: 0.8,
    tunerMute: false,
    sinkId: '',
    recordSource: 'wet' as RecordSource,
    board: null as BoardState | null,
    lowLatency: false
  };
  private irLoader: IrLoader | null = null;

  private async build(sampleRate?: number) {
    const latencyHint = this.state.lowLatency ? 0 : 'interactive';
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ latencyHint, sampleRate });
    } catch {
      ctx = new AudioContext({ latencyHint }); // frecuencia no admitida: la del sistema
    }
    const base = import.meta.env.BASE_URL;
    await Promise.all(
      ['capture', 'gate', 'comp', 'probe', 'looper'].map((n) => ctx.audioWorklet.addModule(`${base}worklets/${n}-processor.js`))
    );

    this.inputGain = new GainNode(ctx, { gain: 1 });
    this.tunerMuteGain = new GainNode(ctx, { gain: 1 });
    this.monitorGain = new GainNode(ctx, { gain: 0 });
    this.meter = new AnalyserNode(ctx, { fftSize: 2048 });
    this.tuner = new AnalyserNode(ctx, { fftSize: 4096 });
    this.capture = new AudioWorkletNode(ctx, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });
    this.silent = new GainNode(ctx, { gain: 0 });
    this.silent.connect(ctx.destination);

    this.inputGain.connect(this.meter);
    this.inputGain.connect(this.tuner);
    const chain = new EffectChain(ctx);
    this.inputGain.connect(chain.input);
    // Protección de salida: transparente hasta -2 dBFS, redondea los picos en vez de recortarlos en seco
    const protectIn = new GainNode(ctx, { gain: 0.5 });
    this.protect = new WaveShaperNode(ctx, { curve: protectCurve() });
    chain.output
      .connect(protectIn)
      .connect(this.protect)
      .connect(this.tunerMuteGain)
      .connect(this.monitorGain)
      .connect(ctx.destination);
    // Los worklets necesitan estar conectados al destino para que el navegador los procese
    this.capture.connect(this.silent);

    this.mixBus = new GainNode(ctx);
    this.protect.connect(this.mixBus);
    this.looper.attach(ctx, this.protect, ctx.destination);
    this.looper.output!.connect(this.mixBus);
    this.transport.attach(ctx, ctx.destination);
    this.transport.output!.connect(this.mixBus);
    this.studio.attach(ctx, ctx.destination, this.mixBus);
    this.song.attach(ctx, ctx.destination, this.mixBus);

    this.capture.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'chunk') this.chunks.push(e.data.channels);
      else if (e.data.type === 'stopped') {
        this.onStopped?.();
        this.onStopped = null;
      }
    };
    this.ctx = ctx;
    this.chain = chain;
  }

  /** Reaplica todo el estado guardado sobre un grafo recién creado. */
  private async restore() {
    const s = this.state;
    if (this.irLoader) this.chain!.setIrLoader(this.irLoader);
    if (s.board) this.chain!.apply(s.board);
    this.setRecordSource(s.recordSource);
    this.setInputGainDb(s.gainDb);
    this.setMonitor(s.monitorOn, s.monitorVolume);
    this.setTunerMute(s.tunerMute);
    if (s.sinkId) await this.setOutputDevice(s.sinkId).catch(() => (s.sinkId = ''));
  }

  private async rebuild(sampleRate?: number) {
    this.detachSource();
    if (this.ctx) await this.ctx.close().catch(() => undefined);
    this.ctx = null;
    this.chain = null;
    await this.build(sampleRate);
    if (this.stream) this.attachStream(this.stream);
    await this.restore();
    if (this.ctx!.state !== 'running') await this.ctx!.resume();
  }

  private attachStream(stream: MediaStream) {
    const ctx = this.ctx!;
    this.source = ctx.createMediaStreamSource(stream);
    this.splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    this.source.connect(this.splitter);
    this.route();
  }

  private detachSource() {
    this.source?.disconnect();
    this.splitter?.disconnect();
    this.source = null;
    this.splitter = null;
  }

  /** Abre una entrada de audio sin el procesado de voz del navegador. */
  async openInput(deviceId?: string): Promise<MediaTrackSettings> {
    this.detachSource();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;

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
    const settings = stream.getAudioTracks()[0]?.getSettings() ?? {};
    const rate = settings.sampleRate;

    if (!this.ctx || (rate && this.ctx.sampleRate !== rate)) {
      await this.rebuild(rate);
    } else {
      this.attachStream(stream);
      if (this.ctx.state !== 'running') await this.ctx.resume();
    }
    return settings;
  }

  /** Cambia entre latencia normal y mínima (reconstruye el grafo). */
  async setLowLatency(on: boolean) {
    if (this.state.lowLatency === on && this.ctx) return;
    this.state.lowLatency = on;
    if (this.ctx) await this.rebuild(this.ctx.sampleRate);
  }

  /** Android suspende el audio en segundo plano: al volver, se reanuda. */
  async resume() {
    if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume().catch(() => undefined);
  }

  setChannelMode(mode: ChannelMode) {
    this.state.channelMode = mode;
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
    const mode = this.state.channelMode;
    if (mode === 'stereo') this.source.connect(this.inputGain);
    else this.splitter.connect(this.inputGain, mode === 'left' ? 0 : 1);
  }

  setInputGainDb(db: number) {
    this.state.gainDb = db;
    if (!this.ctx) return;
    this.inputGain.gain.setTargetAtTime(10 ** (db / 20), this.ctx.currentTime, 0.01);
  }

  setMonitor(on: boolean, volume: number) {
    this.state.monitorOn = on;
    this.state.monitorVolume = volume;
    if (!this.ctx) return;
    this.monitorGain.gain.setTargetAtTime(on ? volume : 0, this.ctx.currentTime, 0.02);
  }

  /** Silencia la salida (no la grabación) mientras se afina, como un pedal afinador. */
  setTunerMute(on: boolean) {
    this.state.tunerMute = on;
    if (!this.ctx) return;
    this.tunerMuteGain.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.01);
  }

  applyBoard(board: BoardState) {
    this.state.board = board;
    this.chain?.apply(board);
  }

  setIrLoader(loader: IrLoader) {
    this.irLoader = loader;
    this.chain?.setIrLoader(loader);
  }

  get canChooseOutput(): boolean {
    return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
  }

  async setOutputDevice(deviceId: string) {
    this.state.sinkId = deviceId;
    if (!this.ctx || !this.canChooseOutput) return;
    await (this.ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(deviceId);
  }

  /** Graba la salida de la pedalera (estéreo) o la señal de la guitarra sin efectos. */
  setRecordSource(source: RecordSource) {
    this.state.recordSource = source;
    if (!this.ctx) return;
    for (const node of [this.inputGain, this.mixBus, this.protect]) {
      try {
        node.disconnect(this.capture);
      } catch {
        /* no estaba conectado */
      }
    }
    if (source === 'wet' || source === 'guitar') {
      this.capture.channelCount = 2;
      this.capture.channelCountMode = 'explicit';
      (source === 'wet' ? this.mixBus : this.protect).connect(this.capture);
    } else {
      this.capture.channelCountMode = 'max';
      this.inputGain.connect(this.capture);
    }
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

  /** Pico máximo de la entrada (dBFS) durante unos milisegundos, para medir el ruido de fondo. */
  async measureNoiseFloor(ms = 2000): Promise<number> {
    let max = -Infinity;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      max = Math.max(max, this.readLevel().peakDb);
      await new Promise((r) => setTimeout(r, 40));
    }
    return max;
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

  /**
   * Mide la latencia real de ida y vuelta: emite 6 clics por la salida y busca cada uno en la entrada
   * por correlación. Necesita que el sonido de la salida llegue a la entrada (altavoz y micrófono,
   * o un cable de salida a entrada). Devuelve null si no se detectan los clics de forma fiable.
   */
  async measureLatency(): Promise<LatencyMeasurement | null> {
    const ctx = this.ctx;
    if (!ctx) return null;
    const sr = ctx.sampleRate;

    // Clic: barrido corto de 1 a 6 kHz con ventana, fácil de distinguir del ruido
    const clickLen = Math.round(sr * 0.003);
    const click = ctx.createBuffer(1, clickLen, sr);
    const cd = click.getChannelData(0);
    for (let i = 0; i < clickLen; i++) {
      const t = i / sr;
      const f = 1000 + (5000 * i) / clickLen;
      cd[i] = Math.sin(2 * Math.PI * f * t) * Math.sin((Math.PI * i) / clickLen) ** 2;
    }

    const clicks = 6;
    const gap = 0.4;
    const lead = 0.3;
    const frames = Math.round(sr * (lead + clicks * gap + 0.5));

    const probe = new AudioWorkletNode(ctx, 'probe-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });
    this.inputGain.connect(probe);
    probe.connect(this.silent);
    const clickOut = new GainNode(ctx, { gain: 0.3 });
    clickOut.connect(ctx.destination);
    // Sin escucha durante la medición, para no medir un acople
    this.monitorGain.gain.setTargetAtTime(0, ctx.currentTime, 0.005);

    const result = new Promise<{ startFrame: number; data: Float32Array }>((resolve) => {
      probe.port.onmessage = (e) => resolve(e.data);
    });
    probe.port.postMessage({ cmd: 'start', frames });
    const t0 = ctx.currentTime + lead;
    for (let k = 0; k < clicks; k++) {
      const src = new AudioBufferSourceNode(ctx, { buffer: click });
      src.connect(clickOut);
      src.start(t0 + k * gap);
    }

    const { startFrame, data } = await result;
    probe.disconnect();
    this.inputGain.disconnect(probe);
    clickOut.disconnect();
    this.setMonitor(this.state.monitorOn, this.state.monitorVolume);

    const lags: number[] = [];
    const win = Math.round(sr * gap * 0.9);
    for (let k = 0; k < clicks; k++) {
      const offset = Math.round((t0 + k * gap) * sr) - startFrame;
      if (offset < 0 || offset + win + clickLen > data.length) continue;
      let best = 0;
      let bestLag = -1;
      let sumAbs = 0;
      for (let lag = 0; lag < win; lag++) {
        let c = 0;
        for (let i = 0; i < clickLen; i++) c += cd[i] * data[offset + lag + i];
        const a = Math.abs(c);
        sumAbs += a;
        if (a > best) {
          best = a;
          bestLag = lag;
        }
      }
      // Solo se acepta si el pico destaca claramente sobre la media
      if (bestLag >= 0 && best > (sumAbs / win) * 12) lags.push(bestLag);
    }
    if (lags.length < 3) return null;
    lags.sort((a, b) => a - b);
    const median = lags[lags.length >> 1];
    const consistent = lags.filter((l) => Math.abs(l - median) < sr * 0.002);
    if (consistent.length < 3) return null;
    return { ms: (median / sr) * 1000, clicks: consistent.length };
  }

  get recordSource() {
    return this.state.recordSource;
  }

  /** Empieza a grabar ya, o en el instante "at" del contexto (s) para alinear con la reproducción. */
  startRecording(at?: number) {
    this.chunks = [];
    const frame = at != null && this.ctx ? Math.round(at * this.ctx.sampleRate) : 0;
    this.capture.port.postMessage({ cmd: 'start', at: frame });
  }

  /**
   * Re-amp: pasa una grabación en seco por una pedalera, fuera de tiempo real.
   * Devuelve audio estéreo con la cola de reverb/delay recortada donde se vuelve silencio.
   */
  async reamp(
    channels: Float32Array[],
    sampleRate: number,
    board: BoardState,
    irLoaderFor: (ctx: BaseAudioContext) => IrLoader,
    tailSeconds = 4
  ): Promise<Float32Array[]> {
    const frames = channels[0]?.length ?? 0;
    const off = new OfflineAudioContext(2, frames + Math.round(tailSeconds * sampleRate), sampleRate);
    const base = import.meta.env.BASE_URL;
    await Promise.all(['gate', 'comp'].map((n) => off.audioWorklet.addModule(`${base}worklets/${n}-processor.js`)));
    const buf = off.createBuffer(channels.length, frames, sampleRate);
    channels.forEach((c, i) => buf.copyToChannel(new Float32Array(c), i));
    const src = new AudioBufferSourceNode(off, { buffer: buf });
    const chain = new EffectChain(off);
    chain.setIrLoader(irLoaderFor(off));
    chain.apply(board);
    await chain.whenReady();
    const protectIn = new GainNode(off, { gain: 0.5 });
    const protect = new WaveShaperNode(off, { curve: protectCurve() });
    src.connect(chain.input);
    chain.output.connect(protectIn).connect(protect).connect(off.destination);
    src.start(0);
    const out = await off.startRendering();
    const l = out.getChannelData(0);
    const r = out.getChannelData(1);
    let end = l.length;
    while (end > frames && Math.abs(l[end - 1]) < 1e-4 && Math.abs(r[end - 1]) < 1e-4) end--;
    return [l.slice(0, end), r.slice(0, end)];
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
