// Definiciones y procesado de cada pedal con nodos nativos de Web Audio.

export type EffectType = 'gate' | 'comp' | 'drive' | 'amp' | 'cab' | 'eq' | 'chorus' | 'delay' | 'reverb';

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  log?: boolean;
  choices?: { value: number; label: string }[];
}

export interface EffectDef {
  type: EffectType;
  name: string;
  /** Efectos en paralelo (chorus, delay, reverb) mantienen la señal seca y añaden la procesada. */
  parallel: boolean;
  params: ParamDef[];
}

export const EFFECT_DEFS: EffectDef[] = [
  {
    type: 'gate',
    name: 'Puerta de ruido',
    parallel: false,
    params: [
      { key: 'threshold', label: 'Umbral', min: -90, max: -20, step: 1, default: -60, unit: 'dB' },
      { key: 'release', label: 'Cierre', min: 20, max: 600, step: 5, default: 120, unit: 'ms' }
    ]
  },
  {
    type: 'comp',
    name: 'Compresor',
    parallel: false,
    params: [
      { key: 'threshold', label: 'Umbral', min: -60, max: 0, step: 1, default: -24, unit: 'dB' },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, default: 4, unit: ':1' },
      { key: 'makeup', label: 'Volumen', min: 0, max: 24, step: 0.5, default: 6, unit: 'dB' }
    ]
  },
  {
    type: 'drive',
    name: 'Saturación',
    parallel: false,
    params: [
      {
        key: 'mode',
        label: 'Tipo',
        min: 0,
        max: 2,
        step: 1,
        default: 0,
        choices: [
          { value: 0, label: 'Overdrive' },
          { value: 1, label: 'Distorsión' },
          { value: 2, label: 'Fuzz' }
        ]
      },
      { key: 'drive', label: 'Ganancia', min: 0, max: 100, step: 1, default: 40, unit: '%' },
      { key: 'tone', label: 'Tono', min: 0, max: 100, step: 1, default: 55, unit: '%' },
      { key: 'level', label: 'Volumen', min: -36, max: 6, step: 0.5, default: -14, unit: 'dB' }
    ]
  },
  {
    type: 'amp',
    name: 'Amplificador',
    parallel: false,
    params: [
      {
        key: 'model',
        label: 'Modelo',
        min: 0,
        max: 2,
        step: 1,
        default: 1,
        choices: [
          { value: 0, label: 'Limpio' },
          { value: 1, label: 'Crunch' },
          { value: 2, label: 'Hi-gain' }
        ]
      },
      { key: 'gain', label: 'Ganancia', min: 0, max: 100, step: 1, default: 50, unit: '%' },
      { key: 'bass', label: 'Graves', min: 0, max: 10, step: 0.1, default: 5 },
      { key: 'mid', label: 'Medios', min: 0, max: 10, step: 0.1, default: 5 },
      { key: 'treble', label: 'Agudos', min: 0, max: 10, step: 0.1, default: 5 },
      { key: 'presence', label: 'Presencia', min: 0, max: 10, step: 0.1, default: 5 },
      { key: 'master', label: 'Volumen', min: 0, max: 10, step: 0.1, default: 5 }
    ]
  },
  {
    type: 'cab',
    name: 'Pantalla',
    parallel: false,
    params: [
      {
        key: 'model',
        label: 'Altavoz',
        min: 0,
        max: 3,
        step: 1,
        default: 2,
        choices: [
          { value: 0, label: '1x12' },
          { value: 1, label: '2x12' },
          { value: 2, label: '4x12' },
          { value: 3, label: 'Propia' }
        ]
      },
      {
        key: 'mic',
        label: 'Micrófono',
        min: 0,
        max: 1,
        step: 1,
        default: 0,
        choices: [
          { value: 0, label: 'Centro' },
          { value: 1, label: 'Borde' }
        ]
      },
      { key: 'level', label: 'Volumen', min: -12, max: 12, step: 0.5, default: 0, unit: 'dB' }
    ]
  },
  {
    type: 'eq',
    name: 'Ecualizador',
    parallel: false,
    params: [
      { key: 'low', label: 'Graves', min: -12, max: 12, step: 0.5, default: 0, unit: 'dB' },
      { key: 'mid', label: 'Medios', min: -12, max: 12, step: 0.5, default: 0, unit: 'dB' },
      { key: 'high', label: 'Agudos', min: -12, max: 12, step: 0.5, default: 0, unit: 'dB' }
    ]
  },
  {
    type: 'chorus',
    name: 'Chorus',
    parallel: true,
    params: [
      { key: 'rate', label: 'Velocidad', min: 0.1, max: 5, step: 0.05, default: 0.8, unit: 'Hz', log: true },
      { key: 'depth', label: 'Profundidad', min: 0, max: 100, step: 1, default: 50, unit: '%' },
      { key: 'mix', label: 'Mezcla', min: 0, max: 100, step: 1, default: 50, unit: '%' }
    ]
  },
  {
    type: 'delay',
    name: 'Delay',
    parallel: true,
    params: [
      { key: 'time', label: 'Tiempo', min: 40, max: 1500, step: 5, default: 380, unit: 'ms', log: true },
      { key: 'feedback', label: 'Repeticiones', min: 0, max: 90, step: 1, default: 30, unit: '%' },
      { key: 'tone', label: 'Tono', min: 0, max: 100, step: 1, default: 50, unit: '%' },
      { key: 'mix', label: 'Mezcla', min: 0, max: 100, step: 1, default: 30, unit: '%' }
    ]
  },
  {
    type: 'reverb',
    name: 'Reverb',
    parallel: true,
    params: [
      { key: 'decay', label: 'Duración', min: 0.4, max: 8, step: 0.1, default: 2, unit: 's', log: true },
      { key: 'tone', label: 'Tono', min: 0, max: 100, step: 1, default: 60, unit: '%' },
      { key: 'mix', label: 'Mezcla', min: 0, max: 100, step: 1, default: 25, unit: '%' }
    ]
  }
];

export const DEF_BY_TYPE = Object.fromEntries(EFFECT_DEFS.map((d) => [d.type, d])) as Record<EffectType, EffectDef>;

const SMOOTH = 0.02;
const pct = (v: number) => v / 100;
const dbToGain = (db: number) => 10 ** (db / 20);
/** 0–100 a una frecuencia en escala logarítmica */
const toneToHz = (v: number, lo: number, hi: number) => lo * (hi / lo) ** pct(v);

export abstract class Effect {
  readonly input: GainNode;
  readonly output: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private coreIn: AudioNode | null = null;
  private coreConnected = false;
  private disconnectTimer = 0;
  enabled = false;

  constructor(protected ctx: BaseAudioContext, readonly def: EffectDef) {
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);
    this.dry = new GainNode(ctx, { gain: 1 });
    this.wet = new GainNode(ctx, { gain: 0 });
    this.input.connect(this.dry).connect(this.output);
    this.wet.connect(this.output);
  }

  protected attachCore(coreIn: AudioNode, coreOut: AudioNode) {
    this.coreIn = coreIn;
    coreOut.connect(this.wet);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    const t = this.ctx.currentTime;
    window.clearTimeout(this.disconnectTimer);
    if (on && !this.coreConnected && this.coreIn) {
      this.input.connect(this.coreIn);
      this.coreConnected = true;
    }
    void t;
    this.ramp(this.wet.gain, on ? 1 : 0);
    this.ramp(this.dry.gain, on && !this.def.parallel ? 0 : 1);
    // Un pedal apagado deja de recibir señal para no gastar CPU
    if (!on && this.coreConnected && this.coreIn) {
      const coreIn = this.coreIn;
      this.disconnectTimer = window.setTimeout(() => {
        this.input.disconnect(coreIn);
        this.coreConnected = false;
      }, 150);
    }
  }

  abstract setParam(key: string, value: number): void;

  /** En tiempo real, transición suave; al procesar fuera de tiempo real (re-amp), valor exacto desde el inicio. */
  protected get offline() {
    return typeof OfflineAudioContext !== 'undefined' && this.ctx instanceof OfflineAudioContext;
  }

  protected ramp(param: AudioParam, value: number, time = SMOOTH) {
    if (this.offline) param.setValueAtTime(value, 0);
    else param.setTargetAtTime(value, this.ctx.currentTime, time);
  }
}

class Gate extends Effect {
  private node: AudioWorkletNode;
  constructor(ctx: BaseAudioContext) {
    super(ctx, DEF_BY_TYPE.gate);
    this.node = new AudioWorkletNode(ctx, 'gate-processor');
    this.attachCore(this.node, this.node);
  }
  setParam(key: string, v: number) {
    const p = this.node.parameters.get(key);
    if (p) p.setValueAtTime(v, this.ctx.currentTime);
  }
}

class Compressor extends Effect {
  private comp: AudioWorkletNode;
  private makeup: GainNode;
  constructor(ctx: BaseAudioContext) {
    super(ctx, DEF_BY_TYPE.comp);
    this.comp = new AudioWorkletNode(ctx, 'comp-processor');
    this.makeup = new GainNode(ctx);
    this.comp.connect(this.makeup);
    this.attachCore(this.comp, this.makeup);
  }
  setParam(key: string, v: number) {
    if (key === 'makeup') this.ramp(this.makeup.gain, dbToGain(v));
    else this.comp.parameters.get(key)?.setValueAtTime(v, this.ctx.currentTime);
  }
}

function makeCurve(mode: number): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    if (mode === 0) {
      curve[i] = Math.tanh(2.5 * x) / Math.tanh(2.5);
    } else if (mode === 1) {
      // Asimétrica: añade armónicos pares, más agresiva
      curve[i] = x >= 0 ? Math.tanh(6 * x) / Math.tanh(6) : (Math.tanh(4 * x) / Math.tanh(4)) * 0.85;
    } else {
      const y = Math.max(-1, Math.min(1, x * 12));
      curve[i] = y * (1 - 0.15 * y * y);
    }
  }
  return curve;
}

class Drive extends Effect {
  private pre: GainNode;
  private tight: BiquadFilterNode;
  private shaper: WaveShaperNode;
  private dcBlock: BiquadFilterNode;
  private tone: BiquadFilterNode;
  private level: GainNode;
  private curves = [0, 1, 2].map(makeCurve);
  constructor(ctx: BaseAudioContext) {
    super(ctx, DEF_BY_TYPE.drive);
    this.tight = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 90, Q: 0.7 });
    this.pre = new GainNode(ctx);
    this.shaper = new WaveShaperNode(ctx, { curve: this.curves[0], oversample: '4x' });
    this.dcBlock = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 25 });
    this.tone = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.6 });
    this.level = new GainNode(ctx);
    this.tight.connect(this.pre).connect(this.shaper).connect(this.dcBlock).connect(this.tone).connect(this.level);
    this.attachCore(this.tight, this.level);
  }
  setParam(key: string, v: number) {
    if (key === 'mode') this.shaper.curve = this.curves[Math.round(v)] ?? this.curves[0];
    else if (key === 'drive') this.ramp(this.pre.gain, dbToGain(6 + pct(v) * 40));
    else if (key === 'tone') this.ramp(this.tone.frequency, toneToHz(v, 900, 9000));
    else if (key === 'level') this.ramp(this.level.gain, dbToGain(v));
  }
}


/* ───────── Amplificador ─────────
 * Modelo de etapas con nodos nativos (procesados en C++ por el navegador, sin latencia añadida):
 * entrada ─► HPF ─► previo 1 (válvula, 4x) ─► acoplo ─► previo 2 (válvula, 4x) ─► tonos ─► etapa de potencia ─► presencia ─► volumen
 */

interface AmpModel {
  inHpf: number;
  pre: [number, number]; // dB de previo 1 con ganancia 0 % y 100 %
  k1: number;
  bias1: number;
  couple: number; // filtro paso alto entre etapas: más alto = graves más "apretados"
  lpf: number;
  stage2: [number, number];
  k2: number;
  bassF: number;
  midF: number;
  midQ: number;
  trebleF: number;
  makeup: number;
}

const AMP_MODELS: AmpModel[] = [
  { inHpf: 40, pre: [0, 22], k1: 0.7, bias1: 0.1, couple: 30, lpf: 9500, stage2: [-6, 0], k2: 0.5, bassF: 120, midF: 500, midQ: 0.6, trebleF: 2800, makeup: 8 },
  { inHpf: 70, pre: [6, 34], k1: 1.1, bias1: 0.25, couple: 140, lpf: 7500, stage2: [0, 12], k2: 1, bassF: 110, midF: 700, midQ: 0.7, trebleF: 2400, makeup: 2 },
  { inHpf: 90, pre: [14, 42], k1: 1.5, bias1: 0.3, couple: 320, lpf: 6500, stage2: [8, 24], k2: 1.4, bassF: 100, midF: 650, midQ: 0.8, trebleF: 2200, makeup: 0 }
];

/** Curva de válvula asimétrica. Dominio ampliado ×4 para que las señales altas no lleguen al borde de la curva. */
function tubeCurve(k: number, bias: number): Float32Array<ArrayBuffer> {
  const n = 8192;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const f = (u: number) => Math.tanh(k * u + bias) - Math.tanh(bias);
  const norm = Math.max(Math.abs(f(4)), Math.abs(f(-4)));
  for (let i = 0; i < n; i++) curve[i] = f(((i / (n - 1)) * 2 - 1) * 4) / norm;
  return curve;
}

const lerp = (r: [number, number], t: number) => r[0] + (r[1] - r[0]) * t;
const knobDb = (v: number, range: number) => ((v - 5) / 5) * range;

class Amp extends Effect {
  private inHpf: BiquadFilterNode;
  private pre1: GainNode;
  private shaper1: WaveShaperNode;
  private couple: BiquadFilterNode;
  private lpf: BiquadFilterNode;
  private pre2: GainNode;
  private shaper2: WaveShaperNode;
  private bass: BiquadFilterNode;
  private mid: BiquadFilterNode;
  private treble: BiquadFilterNode;
  private power: WaveShaperNode;
  private presence: BiquadFilterNode;
  private master: GainNode;
  private p: Record<string, number> = { model: 1, gain: 50, master: 5 };

  constructor(ctx: BaseAudioContext) {
    super(ctx, DEF_BY_TYPE.amp);
    this.inHpf = new BiquadFilterNode(ctx, { type: 'highpass', Q: 0.7 });
    this.pre1 = new GainNode(ctx);
    this.shaper1 = new WaveShaperNode(ctx, { oversample: '4x' });
    this.couple = new BiquadFilterNode(ctx, { type: 'highpass', Q: 0.5 });
    this.lpf = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.5 });
    this.pre2 = new GainNode(ctx);
    this.shaper2 = new WaveShaperNode(ctx, { oversample: '4x' });
    this.bass = new BiquadFilterNode(ctx, { type: 'lowshelf' });
    this.mid = new BiquadFilterNode(ctx, { type: 'peaking' });
    this.treble = new BiquadFilterNode(ctx, { type: 'highshelf' });
    const powerIn = new GainNode(ctx, { gain: 0.5 });
    this.power = new WaveShaperNode(ctx, { curve: tubeCurve(1.2, 0), oversample: '2x' });
    this.presence = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 4000 });
    this.master = new GainNode(ctx);

    this.inHpf
      .connect(this.pre1)
      .connect(this.shaper1)
      .connect(this.couple)
      .connect(this.lpf)
      .connect(this.pre2)
      .connect(this.shaper2)
      .connect(this.bass)
      .connect(this.mid)
      .connect(this.treble)
      .connect(powerIn)
      .connect(this.power)
      .connect(this.presence)
      .connect(this.master);
    this.attachCore(this.inHpf, this.master);
    this.setModel(1);
  }

  private get model() {
    return AMP_MODELS[Math.round(this.p.model)] ?? AMP_MODELS[1];
  }

  private setModel(index: number) {
    this.p.model = index;
    const m = this.model;
    this.shaper1.curve = tubeCurve(m.k1, m.bias1);
    this.shaper2.curve = tubeCurve(m.k2, -0.15);
    this.ramp(this.inHpf.frequency, m.inHpf);
    this.ramp(this.couple.frequency, m.couple);
    this.ramp(this.lpf.frequency, m.lpf);
    this.ramp(this.bass.frequency, m.bassF);
    this.ramp(this.mid.frequency, m.midF);
    this.ramp(this.mid.Q, m.midQ);
    this.ramp(this.treble.frequency, m.trebleF);
    this.updateGain();
    this.updateMaster();
  }

  private updateGain() {
    const t = pct(this.p.gain ?? 50);
    // ÷4: compensa el dominio ampliado de las curvas
    this.ramp(this.pre1.gain, dbToGain(lerp(this.model.pre, t)) / 4);
    this.ramp(this.pre2.gain, dbToGain(lerp(this.model.stage2, t)) / 4);
  }

  private updateMaster() {
    this.ramp(this.master.gain, dbToGain(-24 + (this.p.master ?? 5) * 3 + this.model.makeup));
  }

  setParam(key: string, v: number) {
    if (key === 'model') return this.setModel(Math.round(v));
    this.p[key] = v;
    if (key === 'gain') this.updateGain();
    else if (key === 'master') this.updateMaster();
    else if (key === 'bass') this.ramp(this.bass.gain, knobDb(v, 12));
    else if (key === 'mid') this.ramp(this.mid.gain, knobDb(v, 10));
    else if (key === 'treble') this.ramp(this.treble.gain, knobDb(v, 12));
    else if (key === 'presence') this.ramp(this.presence.gain, knobDb(v, 8));
  }
}

/* ───────── Pantalla (simulación de altavoz por convolución) ───────── */

type FilterSpec = BiquadFilterOptions & { type: BiquadFilterType };

const CABS: FilterSpec[][] = [
  // 1x12 abierta: graves sueltos, más aire
  [
    { type: 'highpass', frequency: 70, Q: 0.7 },
    { type: 'peaking', frequency: 120, Q: 1, gain: 3 },
    { type: 'peaking', frequency: 2500, Q: 1, gain: 3 },
    { type: 'lowpass', frequency: 6000, Q: 1.2 },
    { type: 'lowpass', frequency: 7000, Q: 0.7 }
  ],
  // 2x12
  [
    { type: 'highpass', frequency: 80, Q: 0.9 },
    { type: 'peaking', frequency: 110, Q: 1.2, gain: 4 },
    { type: 'peaking', frequency: 1800, Q: 1, gain: 2 },
    { type: 'peaking', frequency: 4000, Q: 2, gain: -4 },
    { type: 'lowpass', frequency: 5000, Q: 1.4 },
    { type: 'lowpass', frequency: 5500, Q: 0.7 }
  ],
  // 4x12 cerrada: resonancia grave marcada, agudos recortados
  [
    { type: 'highpass', frequency: 85, Q: 1.3 },
    { type: 'peaking', frequency: 100, Q: 1.4, gain: 5 },
    { type: 'peaking', frequency: 400, Q: 1, gain: -2 },
    { type: 'peaking', frequency: 2000, Q: 1.2, gain: 3 },
    { type: 'lowpass', frequency: 4200, Q: 1.6 },
    { type: 'lowpass', frequency: 4800, Q: 0.7 }
  ]
];

const MICS: FilterSpec[] = [
  { type: 'highshelf', frequency: 3000, gain: 2 },
  { type: 'highshelf', frequency: 2200, gain: -6 }
];

const cabCache = new Map<string, Promise<AudioBuffer>>();

/**
 * Normaliza la IR a energía unidad y la baja 10 dB: con señal de guitarra el nivel queda parecido
 * con la pantalla activada o desactivada, y todas las IR (de fábrica o propias) suenan a volumen similar.
 */
function normalizeIr(ctx: BaseAudioContext, ir: AudioBuffer): AudioBuffer {
  let energy = 0;
  for (let c = 0; c < ir.numberOfChannels; c++) for (const s of ir.getChannelData(c)) energy += s * s;
  energy /= ir.numberOfChannels;
  if (energy <= 0) return ir;
  const k = dbToGain(-10) / Math.sqrt(energy);
  const out = ctx.createBuffer(ir.numberOfChannels, ir.length, ir.sampleRate);
  for (let c = 0; c < ir.numberOfChannels; c++) {
    const src = ir.getChannelData(c);
    const dst = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) dst[i] = src[i] * k;
    out.copyToChannel(dst, c);
  }
  return out;
}

/** Genera la respuesta al impulso de un altavoz pasando un impulso por sus filtros (sin archivos externos). */
function cabImpulse(sampleRate: number, model: number, mic: number): Promise<AudioBuffer> {
  const key = `${sampleRate}:${model}:${mic}`;
  let p = cabCache.get(key);
  if (!p) {
    const len = Math.round(sampleRate * 0.08);
    const off = new OfflineAudioContext(1, len, sampleRate);
    const impulse = off.createBuffer(1, len, sampleRate);
    impulse.getChannelData(0)[0] = 1;
    const src = new AudioBufferSourceNode(off, { buffer: impulse });
    let node: AudioNode = src;
    for (const spec of [...CABS[model], MICS[mic]]) node = node.connect(new BiquadFilterNode(off, spec));
    node.connect(off.destination);
    src.start();
    p = off.startRendering().then((ir) => normalizeIr(off, ir));
    cabCache.set(key, p);
  }
  return p;
}

export type IrLoader = (id: string) => Promise<AudioBuffer | null>;

export class Cab extends Effect {
  private conv: ConvolverNode;
  private level: GainNode;
  private model = 2;
  private mic = 0;
  private irId: string | undefined;
  private userIr: AudioBuffer | null = null;
  private token = 0;
  irLoader: IrLoader | null = null;
  private pendingIr: Promise<unknown> = Promise.resolve();
  private pendingBuf: Promise<unknown> = Promise.resolve();
  /** true cuando se ha elegido "IR propia" pero no hay archivo disponible y suena la 4x12 */
  onFallback: ((fallback: boolean) => void) | null = null;

  constructor(ctx: BaseAudioContext) {
    super(ctx, DEF_BY_TYPE.cab);
    this.conv = new ConvolverNode(ctx, { disableNormalization: true });
    this.level = new GainNode(ctx);
    this.conv.connect(this.level);
    this.attachCore(this.conv, this.level);
    this.refresh();
  }

  setIr(id: string | undefined) {
    this.irId = id;
    this.userIr = null;
    if (id && this.irLoader) {
      this.pendingIr = this.irLoader(id)
        .then((buf) => {
          if (this.irId !== id) return;
          this.userIr = buf ? normalizeIr(this.ctx, buf) : null;
          this.refresh();
        })
        .catch(() => this.refresh());
    }
    this.refresh();
  }

  private refresh() {
    const token = ++this.token;
    if (this.model === 3 && this.userIr) {
      this.conv.buffer = this.userIr;
      this.onFallback?.(false);
      return;
    }
    const model = this.model === 3 ? 2 : this.model;
    this.onFallback?.(this.model === 3);
    this.pendingBuf = cabImpulse(this.ctx.sampleRate, model, this.mic).then((buf) => {
      if (token === this.token) this.conv.buffer = buf;
    });
  }

  /** Se resuelve cuando la respuesta de altavoz actual está cargada (necesario antes de un re-amp). */
  async whenReady() {
    await this.pendingIr;
    await this.pendingBuf;
  }

  setParam(key: string, v: number) {
    if (key === 'model') {
      this.model = Math.round(v);
      this.refresh();
    } else if (key === 'mic') {
      this.mic = Math.round(v);
      this.refresh();
    } else if (key === 'level') this.ramp(this.level.gain, dbToGain(v));
  }
}

class Equalizer extends Effect {
  private bands: Record<string, BiquadFilterNode>;
  constructor(ctx: BaseAudioContext) {
    super(ctx, DEF_BY_TYPE.eq);
    const low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 120 });
    const mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 800, Q: 0.8 });
    const high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 3200 });
    low.connect(mid).connect(high);
    this.bands = { low, mid, high };
    this.attachCore(low, high);
  }
  setParam(key: string, v: number) {
    const band = this.bands[key];
    if (band) this.ramp(band.gain, v);
  }
}

class Chorus extends Effect {
  private lfo: OscillatorNode;
  private depthL: GainNode;
  private depthR: GainNode;
  private mix: GainNode;
  constructor(ctx: BaseAudioContext) {
    super(ctx, DEF_BY_TYPE.chorus);
    const split = new GainNode(ctx);
    const dl = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: 0.012 });
    const dr = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: 0.014 });
    this.lfo = new OscillatorNode(ctx, { frequency: 0.8 });
    this.depthL = new GainNode(ctx);
    this.depthR = new GainNode(ctx);
    this.lfo.connect(this.depthL).connect(dl.delayTime);
    this.lfo.connect(this.depthR).connect(dr.delayTime);
    this.lfo.start();
    const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    split.connect(dl).connect(merger, 0, 0);
    split.connect(dr).connect(merger, 0, 1);
    this.mix = new GainNode(ctx);
    merger.connect(this.mix);
    this.attachCore(split, this.mix);
  }
  setParam(key: string, v: number) {
    if (key === 'rate') this.ramp(this.lfo.frequency, v);
    else if (key === 'depth') {
      const d = pct(v) * 0.006;
      this.ramp(this.depthL.gain, d);
      this.ramp(this.depthR.gain, -d); // fase opuesta: más amplitud estéreo
    } else if (key === 'mix') this.ramp(this.mix.gain, pct(v));
  }
}

class Delay extends Effect {
  private delay: DelayNode;
  private feedback: GainNode;
  private filter: BiquadFilterNode;
  private mix: GainNode;
  constructor(ctx: BaseAudioContext) {
    super(ctx, DEF_BY_TYPE.delay);
    this.delay = new DelayNode(ctx, { maxDelayTime: 2 });
    this.filter = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.5 });
    this.feedback = new GainNode(ctx);
    this.mix = new GainNode(ctx);
    this.delay.connect(this.filter);
    this.filter.connect(this.feedback).connect(this.delay);
    this.filter.connect(this.mix);
    this.attachCore(this.delay, this.mix);
  }
  setParam(key: string, v: number) {
    if (key === 'time') this.ramp(this.delay.delayTime, v / 1000, 0.08);
    else if (key === 'feedback') this.ramp(this.feedback.gain, pct(v));
    else if (key === 'tone') this.ramp(this.filter.frequency, toneToHz(v, 1200, 12000));
    else if (key === 'mix') this.ramp(this.mix.gain, pct(v));
  }
}

class Reverb extends Effect {
  private convolver: ConvolverNode;
  private filter: BiquadFilterNode;
  private mix: GainNode;
  private decay = 0;
  private timer = 0;
  constructor(ctx: BaseAudioContext) {
    super(ctx, DEF_BY_TYPE.reverb);
    this.convolver = new ConvolverNode(ctx);
    this.filter = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.5 });
    this.mix = new GainNode(ctx);
    this.convolver.connect(this.filter).connect(this.mix);
    this.attachCore(this.convolver, this.mix);
    this.buildImpulse(2);
  }
  /** Respuesta al impulso sintética: ruido estéreo con caída exponencial (−60 dB en "decay" segundos). */
  private buildImpulse(decay: number) {
    this.decay = decay;
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * decay);
    const ir = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const data = ir.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const fadeIn = Math.min(1, t / 0.004);
        data[i] = (Math.random() * 2 - 1) * Math.exp((-6.9 * t) / decay) * fadeIn;
      }
    }
    this.convolver.buffer = ir;
  }
  setParam(key: string, v: number) {
    if (key === 'decay' && v !== this.decay) {
      window.clearTimeout(this.timer);
      if (this.offline) this.buildImpulse(v);
      else this.timer = window.setTimeout(() => this.buildImpulse(v), 150);
    } else if (key === 'tone') this.ramp(this.filter.frequency, toneToHz(v, 1500, 14000));
    else if (key === 'mix') this.ramp(this.mix.gain, pct(v) * 1.5);
  }
}

export function createEffect(ctx: BaseAudioContext, type: EffectType): Effect {
  switch (type) {
    case 'gate':
      return new Gate(ctx);
    case 'comp':
      return new Compressor(ctx);
    case 'drive':
      return new Drive(ctx);
    case 'amp':
      return new Amp(ctx);
    case 'cab':
      return new Cab(ctx);
    case 'eq':
      return new Equalizer(ctx);
    case 'chorus':
      return new Chorus(ctx);
    case 'delay':
      return new Delay(ctx);
    case 'reverb':
      return new Reverb(ctx);
  }
}
