import { makeSamples, type DrumVoice } from './drums';

export interface RhythmSettings {
  bpm: number;
  beatsPerBar: number;
  metronome: boolean;
  metronomeVolume: number;
  drums: boolean;
  drumVolume: number;
  swing: number;
  steps: Record<DrumVoice, number[]>;
}

const LOOKAHEAD = 0.12; // s programados por adelantado
const INTERVAL = 25; // ms entre revisiones del programador

/**
 * Reloj de tempo compartido por metrónomo, caja de ritmos y looper.
 * Programa los golpes con antelación sobre el reloj del AudioContext (precisión de muestra),
 * no con temporizadores de JavaScript.
 */
export class Transport {
  private ctx: AudioContext | null = null;
  readonly busName = 'rhythm';
  output: GainNode | null = null;
  private metroGain: GainNode | null = null;
  private drumGain: GainNode | null = null;
  private samples: ReturnType<typeof makeSamples> | null = null;
  private timer = 0;
  private startTime = 0;
  private nextStep = 0;
  private forcedClicksUntil = 0;
  playing = false;
  s: RhythmSettings;

  constructor(initial: RhythmSettings) {
    this.s = initial;
  }

  attach(ctx: AudioContext, destination: AudioNode) {
    this.stop();
    this.ctx = ctx;
    this.output = new GainNode(ctx);
    this.metroGain = new GainNode(ctx, { gain: this.s.metronomeVolume });
    this.drumGain = new GainNode(ctx, { gain: this.s.drumVolume });
    this.metroGain.connect(this.output);
    this.drumGain.connect(this.output);
    this.output.connect(destination);
    this.samples = makeSamples(ctx);
  }

  private get stepDur() {
    return 60 / this.s.bpm / 4;
  }

  get barDur() {
    return this.s.beatsPerBar * 4 * this.stepDur;
  }

  private stepTime(step: number) {
    // Swing: retrasa la corchea a contratiempo hacia la posición de tresillo
    const swingDelay = ((step % 4) + 4) % 4 === 2 ? this.s.swing * (2 / 3) * this.stepDur : 0;
    return this.startTime + step * this.stepDur + swingDelay;
  }

  update(patch: Partial<RhythmSettings>) {
    const ctx = this.ctx;
    if (patch.bpm && patch.bpm !== this.s.bpm && this.playing && ctx) {
      // Mantiene la posición al cambiar de tempo
      const t = this.startTime + this.nextStep * this.stepDur;
      this.s = { ...this.s, ...patch };
      this.startTime = t - this.nextStep * this.stepDur;
    } else this.s = { ...this.s, ...patch };
    if (ctx) {
      this.metroGain?.gain.setTargetAtTime(this.s.metronomeVolume, ctx.currentTime, 0.02);
      this.drumGain?.gain.setTargetAtTime(this.s.drumVolume, ctx.currentTime, 0.02);
    }
  }

  /** Arranca en "at" (tiempo del contexto). Con countInBars, el metrónomo suena esos compases aunque esté apagado. */
  start(at?: number, countInBars = 0) {
    if (!this.ctx) return;
    this.stop();
    this.startTime = at ?? this.ctx.currentTime + 0.05;
    this.nextStep = 0;
    this.forcedClicksUntil = this.startTime + countInBars * this.barDur - 0.001;
    this.playing = true;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), INTERVAL);
  }

  /**
   * Arranca con el compás 0 en "zero" (puede estar en el pasado o en el futuro), para alinear el
   * ritmo con una posición del multipista. Hasta "forcedUntil" suena la cuenta atrás.
   */
  run(zero: number, forcedUntil = 0) {
    if (!this.ctx) return;
    this.stop();
    this.startTime = zero;
    this.forcedClicksUntil = forcedUntil;
    this.nextStep = Math.ceil((this.ctx.currentTime + 0.01 - zero) / this.stepDur);
    this.playing = true;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), INTERVAL);
  }

  stop() {
    window.clearInterval(this.timer);
    this.playing = false;
  }

  /** Inicio del siguiente compás a partir de "after" (o null si está parado). */
  nextBarTime(after?: number): number | null {
    if (!this.playing || !this.ctx) return null;
    const t = after ?? this.ctx.currentTime;
    const n = Math.max(0, Math.ceil((t - this.startTime) / this.barDur - 1e-6));
    return this.startTime + n * this.barDur;
  }

  /** Posición actual para la interfaz: paso dentro del compás y pulso. */
  position(): { step: number; beat: number; bar: number; countIn: boolean } | null {
    if (!this.playing || !this.ctx) return null;
    const t = this.ctx.currentTime - (this.ctx.outputLatency || 0);
    if (t < this.startTime) return null;
    const total = Math.floor((t - this.startTime) / this.stepDur);
    const perBar = this.s.beatsPerBar * 4;
    const step = total % perBar;
    return { step, beat: Math.floor(step / 4), bar: Math.floor(total / perBar), countIn: t < this.forcedClicksUntil };
  }

  private play(buffer: AudioBuffer, dest: AudioNode, time: number, gain = 1) {
    const src = new AudioBufferSourceNode(this.ctx!, { buffer });
    if (gain === 1) src.connect(dest);
    else src.connect(new GainNode(this.ctx!, { gain })).connect(dest);
    src.start(time);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.samples) return;
    const perBar = this.s.beatsPerBar * 4;
    while (this.stepTime(this.nextStep) < ctx.currentTime + LOOKAHEAD) {
      const step = this.nextStep;
      const time = Math.max(ctx.currentTime, this.stepTime(step));
      const inBar = ((step % perBar) + perBar) % perBar;
      if (inBar % 4 === 0 && (this.s.metronome || time < this.forcedClicksUntil)) {
        this.play(inBar === 0 ? this.samples.accent : this.samples.click, this.metroGain!, time);
      }
      if (this.s.drums && time >= this.forcedClicksUntil) {
        for (const voice of ['kick', 'snare', 'hat', 'open'] as DrumVoice[]) {
          const v = this.s.steps[voice]?.[inBar] ?? 0;
          if (v > 0) this.play(this.samples[voice], this.drumGain!, time, v);
        }
      }
      this.nextStep++;
    }
  }
}
