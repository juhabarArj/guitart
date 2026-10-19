// Definiciones y procesado de cada pedal con nodos nativos de Web Audio.

export type EffectType = 'gate' | 'comp' | 'drive' | 'eq' | 'chorus' | 'delay' | 'reverb';

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

  constructor(protected ctx: AudioContext, readonly def: EffectDef) {
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
    this.wet.gain.setTargetAtTime(on ? 1 : 0, t, SMOOTH);
    this.dry.gain.setTargetAtTime(on && !this.def.parallel ? 0 : 1, t, SMOOTH);
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

  protected ramp(param: AudioParam, value: number, time = SMOOTH) {
    param.setTargetAtTime(value, this.ctx.currentTime, time);
  }
}

class Gate extends Effect {
  private node: AudioWorkletNode;
  constructor(ctx: AudioContext) {
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
  private comp: DynamicsCompressorNode;
  private makeup: GainNode;
  constructor(ctx: AudioContext) {
    super(ctx, DEF_BY_TYPE.comp);
    this.comp = new DynamicsCompressorNode(ctx, { knee: 6, attack: 0.005, release: 0.15 });
    this.makeup = new GainNode(ctx);
    this.comp.connect(this.makeup);
    this.attachCore(this.comp, this.makeup);
  }
  setParam(key: string, v: number) {
    if (key === 'threshold') this.ramp(this.comp.threshold, v);
    else if (key === 'ratio') this.ramp(this.comp.ratio, v);
    else if (key === 'makeup') this.ramp(this.makeup.gain, dbToGain(v));
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
  constructor(ctx: AudioContext) {
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

class Equalizer extends Effect {
  private bands: Record<string, BiquadFilterNode>;
  constructor(ctx: AudioContext) {
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
  constructor(ctx: AudioContext) {
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
  constructor(ctx: AudioContext) {
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
  constructor(ctx: AudioContext) {
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
      this.timer = window.setTimeout(() => this.buildImpulse(v), 150);
    } else if (key === 'tone') this.ramp(this.filter.frequency, toneToHz(v, 1500, 14000));
    else if (key === 'mix') this.ramp(this.mix.gain, pct(v) * 1.5);
  }
}

export function createEffect(ctx: AudioContext, type: EffectType): Effect {
  switch (type) {
    case 'gate':
      return new Gate(ctx);
    case 'comp':
      return new Compressor(ctx);
    case 'drive':
      return new Drive(ctx);
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
