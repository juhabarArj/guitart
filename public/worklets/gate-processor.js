// Puerta de ruido: abre cuando la señal supera el umbral y cierra con un release suave.
class GateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -55, minValue: -90, maxValue: 0, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 120, minValue: 10, maxValue: 1000, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.env = 0;
    this.gain = 0;
    this.hold = 0;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const open = 10 ** (params.threshold[0] / 20);
    const close = open * 0.7; // histéresis para que no tartamudee en el umbral
    const attack = Math.exp(-1 / (0.0008 * sampleRate));
    const release = Math.exp(-1 / ((params.release[0] / 1000) * sampleRate));
    const envFall = Math.exp(-1 / (0.03 * sampleRate));
    const holdSamples = 0.04 * sampleRate;
    const frames = input[0].length;

    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < input.length; c++) {
        const a = Math.abs(input[c][i]);
        if (a > peak) peak = a;
      }
      this.env = peak > this.env ? peak : this.env * envFall + peak * (1 - envFall);

      let target = 0;
      if (this.env > open || (this.gain > 0.5 && this.env > close)) {
        target = 1;
        this.hold = holdSamples;
      } else if (this.hold > 0) {
        this.hold--;
        target = 1;
      }
      const coef = target > this.gain ? attack : release;
      this.gain = target + (this.gain - target) * coef;

      for (let c = 0; c < output.length; c++) {
        output[c][i] = (input[c] ?? input[0])[i] * this.gain;
      }
    }
    return true;
  }
}

registerProcessor('gate-processor', GateProcessor);
