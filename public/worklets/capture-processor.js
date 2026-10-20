// Captura PCM sin pérdida en el hilo de audio y lo envía al hilo principal
// en bloques de 4096 muestras por canal.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.blockSize = 4096;
    this.buffers = null;
    this.filled = 0;
    this.port.onmessage = (e) => {
      if (e.data.cmd === 'start') {
        this.buffers = null;
        this.filled = 0;
        this.startAt = e.data.at ?? 0; // muestra del contexto en la que empieza (0 = ya)
        this.recording = true;
      } else if (e.data.cmd === 'stop') {
        this.recording = false;
        this.flush();
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  ensure(channelCount) {
    if (!this.buffers || this.buffers.length !== channelCount) {
      this.flush();
      this.buffers = Array.from({ length: channelCount }, () => new Float32Array(this.blockSize));
      this.filled = 0;
    }
  }

  flush() {
    if (!this.buffers || this.filled === 0) return;
    const channels = this.buffers.map((b) => b.slice(0, this.filled));
    this.port.postMessage({ type: 'chunk', channels }, channels.map((c) => c.buffer));
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (this.recording && input && input.length > 0) {
      const frames = input[0].length;
      if (this.startAt > currentFrame + frames) return true;
      this.ensure(input.length);
      let read = Math.max(0, this.startAt - currentFrame);
      this.startAt = 0;
      while (read < frames) {
        const n = Math.min(frames - read, this.blockSize - this.filled);
        for (let ch = 0; ch < input.length; ch++) {
          this.buffers[ch].set(input[ch].subarray(read, read + n), this.filled);
        }
        this.filled += n;
        read += n;
        if (this.filled === this.blockSize) this.flush();
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
