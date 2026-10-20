// Reproductor del multipista: cada pista es un clip con volumen, panorama, silencio y solo.

export interface StudioTrack {
  id: string;
  name: string;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  /** Qué se graba en esta pista: guitarra con efectos o en seco */
  source: 'guitar' | 'dry';
  /** Segundo del proyecto en que empieza el clip */
  start: number;
  audio: AudioBuffer | null;
  /** Original sin efectos, si existe: permite hacer re-amp */
  dry: AudioBuffer | null;
  reamped: boolean;
}

export const audible = (t: StudioTrack, all: StudioTrack[]) => !t.mute && (!all.some((x) => x.solo) || t.solo);

export class StudioPlayer {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private voices = new Map<string, { src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode }>();
  playing = false;
  private startCtx = 0;
  private startPos = 0;

  attach(ctx: AudioContext, destination: AudioNode, mixBus: AudioNode) {
    this.stop();
    this.ctx = ctx;
    this.bus = new GainNode(ctx);
    this.bus.connect(destination);
    this.bus.connect(mixBus);
  }

  /** Reproduce desde "fromPos" (s del proyecto) empezando en el instante "at" del contexto. */
  play(tracks: StudioTrack[], fromPos: number, at: number, skipId?: string) {
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    this.stop();
    for (const t of tracks) {
      if (!t.audio || t.id === skipId) continue;
      const end = t.start + t.audio.duration;
      if (end <= fromPos) continue;
      const src = new AudioBufferSourceNode(ctx, { buffer: t.audio });
      const gain = new GainNode(ctx, { gain: audible(t, tracks) ? t.volume : 0 });
      const pan = new StereoPannerNode(ctx, { pan: t.pan });
      src.connect(gain).connect(pan).connect(this.bus);
      const delay = Math.max(0, t.start - fromPos);
      src.start(at + delay, Math.max(0, fromPos - t.start));
      this.voices.set(t.id, { src, gain, pan });
    }
    this.startCtx = at;
    this.startPos = fromPos;
    this.playing = true;
  }

  /** Aplica en vivo los cambios del mezclador. */
  updateMix(tracks: StudioTrack[]) {
    if (!this.ctx) return;
    for (const t of tracks) {
      const v = this.voices.get(t.id);
      if (!v) continue;
      v.gain.gain.setTargetAtTime(audible(t, tracks) ? t.volume : 0, this.ctx.currentTime, 0.02);
      v.pan.pan.setTargetAtTime(t.pan, this.ctx.currentTime, 0.02);
    }
  }

  stop() {
    for (const v of this.voices.values()) {
      try {
        v.src.stop();
      } catch {
        /* ya parado */
      }
      v.src.disconnect();
    }
    this.voices.clear();
    this.playing = false;
  }

  /** Posición actual en segundos del proyecto, tal como se oye. */
  position(): number {
    if (!this.playing || !this.ctx) return this.startPos;
    const heard = this.ctx.currentTime - (this.ctx.outputLatency || 0);
    return this.startPos + Math.max(0, heard - this.startCtx);
  }
}

/** Mezcla final del proyecto fuera de tiempo real. */
export async function renderMix(tracks: StudioTrack[], sampleRate: number): Promise<AudioBuffer | null> {
  const end = Math.max(0, ...tracks.filter((t) => t.audio).map((t) => t.start + t.audio!.duration));
  if (end <= 0) return null;
  const off = new OfflineAudioContext(2, Math.ceil(end * sampleRate), sampleRate);
  for (const t of tracks) {
    if (!t.audio || !audible(t, tracks)) continue;
    const src = new AudioBufferSourceNode(off, { buffer: t.audio });
    src
      .connect(new GainNode(off, { gain: t.volume }))
      .connect(new StereoPannerNode(off, { pan: t.pan }))
      .connect(off.destination);
    src.start(t.start);
  }
  return off.startRendering();
}
