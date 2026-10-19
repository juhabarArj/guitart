// Detección de tono con el algoritmo YIN (de Cheveigné y Kawahara, 2002).

export function detectPitch(buf: Float32Array, sampleRate: number, threshold = 0.15): number | null {
  let energy = 0;
  for (let i = 0; i < buf.length; i++) energy += buf[i] * buf[i];
  if (Math.sqrt(energy / buf.length) < 0.008) return null; // demasiado silencio

  const half = buf.length >> 1;
  const maxTau = Math.min(half - 1, Math.floor(sampleRate / 60)); // hasta ~60 Hz (afinaciones bajas)
  const minTau = Math.max(2, Math.floor(sampleRate / 1500));
  const d = new Float32Array(maxTau + 1);

  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // Diferencia normalizada acumulada
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    d[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
  }

  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= maxTau && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  // Interpolación parabólica para precisión por debajo de una muestra
  const x0 = d[tau - 1];
  const x1 = d[tau];
  const x2 = tau + 1 <= maxTau ? d[tau + 1] : x1;
  const denom = x0 + x2 - 2 * x1;
  const refined = denom !== 0 ? tau + (x0 - x2) / (2 * denom) : tau;
  return sampleRate / refined;
}

const LATIN = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const LETTER = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export interface NoteReading {
  freq: number;
  midi: number;
  cents: number;
  latin: string;
  letter: string;
  octave: number;
}

export function noteFromFreq(freq: number, a4 = 440): NoteReading {
  const exact = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(exact);
  const cents = (exact - midi) * 100;
  const idx = ((midi % 12) + 12) % 12;
  return { freq, midi, cents, latin: LATIN[idx], letter: LETTER[idx], octave: Math.floor(midi / 12) - 1 };
}

export const STANDARD_TUNING = [
  { midi: 40, latin: 'Mi', letter: 'E2' },
  { midi: 45, latin: 'La', letter: 'A2' },
  { midi: 50, latin: 'Re', letter: 'D3' },
  { midi: 55, latin: 'Sol', letter: 'G3' },
  { midi: 59, latin: 'Si', letter: 'B3' },
  { midi: 64, latin: 'Mi', letter: 'E4' }
];
