// Reproductor de canciones para practicar: velocidad sin cambiar el tono y bucle A-B.
// Usa un elemento <audio> (el navegador conserva el tono al cambiar la velocidad) conectado al motor.

export interface LoopRange {
  a: number;
  b: number;
  on: boolean;
}

export class SongPlayer {
  private el: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private url: string | null = null;
  private timer = 0;
  private rate = 1;
  private volume = 0.9;
  loop: LoopRange = { a: 0, b: 0, on: false };
  onEnded: (() => void) | null = null;

  /** Se llama al crear (o reconstruir) el motor de audio. */
  attach(ctx: AudioContext, destination: AudioNode, mixBus: AudioNode) {
    const at = this.el?.currentTime ?? 0;
    this.el?.pause();
    this.ctx = ctx;
    const el = new Audio();
    el.preservesPitch = true;
    (el as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
    el.onended = () => this.onEnded?.();
    this.gain = new GainNode(ctx, { gain: this.volume });
    ctx.createMediaElementSource(el).connect(this.gain);
    this.gain.connect(destination);
    this.gain.connect(mixBus);
    this.el = el;
    if (this.url) {
      el.src = this.url;
      el.currentTime = at;
      el.playbackRate = this.rate;
    }
  }

  load(blob: Blob) {
    this.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    this.loop = { a: 0, b: 0, on: false };
    if (this.el) {
      this.el.src = this.url;
      this.el.playbackRate = this.rate;
    }
  }

  unload() {
    this.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    if (this.el) this.el.removeAttribute('src');
  }

  get loaded() {
    return !!this.url;
  }

  get playing() {
    return !!this.el && !this.el.paused;
  }

  get time() {
    return this.el?.currentTime ?? 0;
  }

  async play() {
    if (!this.el || !this.url) return;
    if (this.ctx?.state !== 'running') await this.ctx?.resume();
    if (this.loop.on && (this.el.currentTime < this.loop.a || this.el.currentTime >= this.loop.b)) this.el.currentTime = this.loop.a;
    await this.el.play();
    // El bucle se vigila cada 10 ms: más preciso que el evento timeupdate (cada ~250 ms)
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      const el = this.el;
      if (!el) return;
      if (this.loop.on && this.loop.b > this.loop.a && el.currentTime >= this.loop.b) el.currentTime = this.loop.a;
    }, 10);
  }

  pause() {
    window.clearInterval(this.timer);
    this.el?.pause();
  }

  seek(t: number) {
    if (this.el) this.el.currentTime = Math.max(0, t);
  }

  setRate(r: number) {
    this.rate = r;
    if (this.el) this.el.playbackRate = r;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
}
