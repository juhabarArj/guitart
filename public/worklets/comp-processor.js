// Compresor sin anticipación (lookahead): no añade latencia, a diferencia de DynamicsCompressorNode.
class CompProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -24, minValue: -60, maxValue: 0, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 4, minValue: 1, maxValue: 20, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.env = 0;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const threshold = params.threshold[0];
    const slope = 1 / params.ratio[0] - 1;
    const knee = 6;
    const attack = Math.exp(-1 / (0.003 * sampleRate));
    const release = Math.exp(-1 / (0.15 * sampleRate));
    const frames = input[0].length;

    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < input.length; c++) {
        const a = Math.abs(input[c][i]);
        if (a > peak) peak = a;
      }
      const coef = peak > this.env ? attack : release;
      this.env = coef * this.env + (1 - coef) * peak;

      const over = 20 * Math.log10(this.env + 1e-9) - threshold;
      let reduction = 0;
      if (2 * over > knee) reduction = slope * over;
      else if (2 * over > -knee) reduction = (slope * (over + knee / 2) ** 2) / (2 * knee);
      const gain = 10 ** (reduction / 20);

      for (let c = 0; c < output.length; c++) {
        output[c][i] = (input[c] ?? input[0])[i] * gain;
      }
    }
    return true;
  }
}

registerProcessor('comp-processor', CompProcessor);
