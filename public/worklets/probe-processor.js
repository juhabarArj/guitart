// Graba la entrada durante un número fijo de muestras y devuelve en qué muestra del contexto empezó.
// Sirve para medir la latencia de ida y vuelta comparando con el momento en que se programaron los clics.
class ProbeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = null;
    this.pos = 0;
    this.startFrame = -1;
    this.port.onmessage = (e) => {
      if (e.data.cmd === 'start') {
        this.buf = new Float32Array(e.data.frames);
        this.pos = 0;
        this.startFrame = -1;
      }
    };
  }

  process(inputs, outputs) {
    if (!this.buf) return true;
    const input = inputs[0];
    const frames = outputs[0]?.[0]?.length ?? 128;
    if (this.startFrame < 0) this.startFrame = currentFrame;
    for (let i = 0; i < frames && this.pos < this.buf.length; i++) {
      let s = 0;
      for (let c = 0; c < input.length; c++) s += input[c][i];
      this.buf[this.pos++] = input.length ? s / input.length : 0;
    }
    if (this.pos >= this.buf.length) {
      this.port.postMessage({ startFrame: this.startFrame, data: this.buf }, [this.buf.buffer]);
      this.buf = null;
    }
    return true;
  }
}

registerProcessor('probe-processor', ProbeProcessor);
