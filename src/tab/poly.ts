// Transcripción de acordes con el modelo Basic Pitch (Spotify, Apache 2.0).
// Se carga bajo demanda: TensorFlow.js y el modelo solo se descargan la primera vez que se usa.
import type { RawNote } from './transcribe';

const MODEL_RATE = 22050;

export async function transcribePoly(
  mono: Float32Array,
  sr: number,
  sensitivity: number,
  onProgress?: (p: number) => void
): Promise<RawNote[]> {
  onProgress?.(0);
  const { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } = await import('@spotify/basic-pitch');

  // El modelo trabaja a 22 050 Hz en mono
  const off = new OfflineAudioContext(1, Math.ceil((mono.length * MODEL_RATE) / sr), MODEL_RATE);
  const buf = off.createBuffer(1, mono.length, sr);
  buf.copyToChannel(new Float32Array(mono), 0);
  const src = new AudioBufferSourceNode(off, { buffer: buf });
  src.connect(off.destination);
  src.start();
  const resampled = (await off.startRendering()).getChannelData(0);

  const model = new BasicPitch(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await model.evaluateModel(
    resampled,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => onProgress?.(p)
  );

  // Umbrales: más sensibilidad = acepta notas más débiles (y más notas falsas)
  const onsetThresh = 0.6 - 0.3 * sensitivity;
  const frameThresh = 0.4 - 0.2 * sensitivity;
  const events = noteFramesToTime(
    addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, onsetThresh, frameThresh, 5, true, 1500, 70, true))
  );

  return events
    .map((e): RawNote => {
      // Curva de tono en tercios de semitono respecto a la nota
      const pb = (e.pitchBends ?? []).map((v) => v / 3);
      const peak = pb.length ? Math.max(...pb) : 0;
      const bend = peak >= 0.8 ? Math.min(3, Math.round(peak)) : 0;
      let crossings = 0;
      let side = 0;
      const mean = pb.reduce((a, b) => a + b, 0) / Math.max(1, pb.length);
      for (const v of pb) {
        const s = v - mean > 0.1 ? 1 : v - mean < -0.1 ? -1 : 0;
        if (s && side && s !== side) crossings++;
        if (s) side = s;
      }
      return {
        t: e.startTimeSeconds,
        end: e.startTimeSeconds + e.durationSeconds,
        midi: e.pitchMidi,
        cents: 0,
        ...(bend ? { bend } : {}),
        ...(!bend && crossings >= 4 ? { vib: true } : {})
      };
    })
    .sort((a, b) => a.t - b.t || a.midi - b.midi);
}
