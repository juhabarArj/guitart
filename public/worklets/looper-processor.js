// Looper: graba una vuelta, la repite y permite superponer capas y deshacer la última.
// Compensa la latencia de ida y vuelta: lo que entra ahora se tocó escuchando el bucle "lat" muestras antes.
const MAX_SECONDS = 60;

class LooperProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.maxLen = Math.floor(MAX_SECONDS * sampleRate);
    this.mix = null; // capas consolidadas
    this.layer = null; // última capa (se puede deshacer)
    this.hasLayer = false;
    this.layers = 0;
    this.len = 0;
    this.pos = 0;
    this.state = 'empty';
    this.lat = 0;
    this.recStart = 0;
    this.recIdx = 0;
    this.fillIdx = -1;
    this.dubTail = 0;
    this.pending = [];
    this.reportEvery = Math.floor(sampleRate / 30);
    this.sinceReport = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.cmd === 'latency') this.lat = Math.max(0, Math.round(m.frames));
      else {
        this.pending.push(m);
        this.pending.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
        if (m.cmd === 'rec' && this.state === 'empty' && (m.at ?? 0) > currentFrame) this.setState('armed');
        this.report();
      }
    };
  }

  alloc() {
    if (!this.mix) this.mix = [new Float32Array(this.maxLen), new Float32Array(this.maxLen)];
    if (!this.layer) this.layer = [new Float32Array(this.maxLen), new Float32Array(this.maxLen)];
  }

  setState(s) {
    this.state = s;
    this.report();
  }

  report() {
    this.sinceReport = 0;
    this.port.postMessage({
      state: this.state,
      pos: this.pos,
      len: this.len,
      layers: this.layers,
      canUndo: this.hasLayer,
      pending: this.pending.length ? this.pending[0].cmd : null,
      recorded: this.state === 'recording' ? this.recIdx : 0
    });
  }

  commitLayer() {
    if (!this.hasLayer) return;
    for (let c = 0; c < 2; c++) {
      const m = this.mix[c];
      const l = this.layer[c];
      for (let i = 0; i < this.len; i++) {
        m[i] += l[i];
        l[i] = 0;
      }
    }
    this.hasLayer = false;
  }

  close(f) {
    this.len = Math.max(1, f - this.recStart);
    this.fillIdx = this.recIdx; // faltan "lat" muestras por llegar
    this.pos = 0;
    this.layers = 1;
  }

  exec(m, f) {
    const s = this.state;
    switch (m.cmd) {
      case 'rec':
        if (s === 'empty' || s === 'armed') {
          this.alloc();
          this.recStart = f;
          this.recIdx = 0;
          this.setState('recording');
        } else if (s === 'recording') {
          this.close(f);
          this.setState('playing');
        } else if (s === 'playing' || s === 'stopped') {
          this.commitLayer();
          if (s === 'stopped') this.pos = 0;
          this.dubTail = 0;
          this.layers++;
          this.setState('overdub');
        } else if (s === 'overdub') {
          this.dubTail = this.lat;
          this.setState('playing');
        }
        break;
      case 'play':
        if (s === 'stopped' && this.len > 0) {
          this.pos = 0;
          this.setState('playing');
        }
        break;
      case 'stop':
        if (s === 'recording') {
          this.close(f);
          this.fillIdx = -1;
          this.len = Math.max(1, this.recIdx);
        }
        if (s === 'armed') this.setState('empty');
        else if (this.len > 0) {
          this.dubTail = 0;
          this.pos = 0;
          this.setState('stopped');
        }
        break;
      case 'undo':
        if (this.hasLayer) {
          for (const l of this.layer) l.fill(0, 0, this.len);
          this.hasLayer = false;
          this.layers--;
          this.dubTail = 0;
          if (s === 'overdub') this.setState('playing');
          else this.report();
        }
        break;
      case 'clear':
        this.pending = [];
        this.len = 0;
        this.pos = 0;
        this.layers = 0;
        this.fillIdx = -1;
        this.dubTail = 0;
        if (this.hasLayer) for (const l of this.layer) l.fill(0);
        this.hasLayer = false;
        this.setState('empty');
        break;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const out = outputs[0];
    const frames = out[0].length;
    const inL = input[0];
    const inR = input[1] ?? input[0];

    for (let i = 0; i < frames; i++) {
      const f = currentFrame + i;
      while (this.pending.length && (this.pending[0].at ?? 0) <= f) this.exec(this.pending.shift(), f);

      const xL = inL ? inL[i] : 0;
      const xR = inR ? inR[i] : 0;
      let yL = 0;
      let yR = 0;
      const st = this.state;

      if (st === 'recording') {
        if (f >= this.recStart + this.lat) {
          if (this.recIdx < this.maxLen) {
            this.mix[0][this.recIdx] = xL;
            this.mix[1][this.recIdx] = xR;
            this.recIdx++;
          } else {
            this.close(f);
            this.fillIdx = -1;
            this.len = this.maxLen;
            this.setState('playing');
          }
        }
      } else if (st === 'playing' || st === 'overdub') {
        const p = this.pos;
        yL = this.mix[0][p];
        yR = this.mix[1][p];
        if (this.hasLayer || st === 'overdub' || this.dubTail > 0) {
          yL += this.layer[0][p];
          yR += this.layer[1][p];
        }
        // Termina de rellenar el final de la primera vuelta (latencia)
        if (this.fillIdx >= 0) {
          if (this.fillIdx < this.len) {
            this.mix[0][this.fillIdx] = xL;
            this.mix[1][this.fillIdx] = xR;
            this.fillIdx++;
          } else this.fillIdx = -1;
        }
        if (st === 'overdub' || this.dubTail > 0) {
          const w = (((p - this.lat) % this.len) + this.len) % this.len;
          this.layer[0][w] += xL;
          this.layer[1][w] += xR;
          this.hasLayer = true;
          if (this.dubTail > 0) this.dubTail--;
        }
        this.pos = p + 1 >= this.len ? 0 : p + 1;
      }

      out[0][i] = yL;
      if (out[1]) out[1][i] = yR;
    }

    this.sinceReport += frames;
    if (this.sinceReport >= this.reportEvery) this.report();
    return true;
  }
}

registerProcessor('looper-processor', LooperProcessor);
