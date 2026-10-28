// Proyecto del multipista guardado en este navegador (una sola sesión de trabajo).
import { encodeWav } from '../audio/wav';
import type { StudioTrack } from '../audio/studio';
import { packAudio, unpackAudio, type PackedAudio } from './codec';
import { run } from './db';

interface StoredTrack extends Omit<StudioTrack, 'audio' | 'dry'> {
  audio: Blob | PackedAudio | null;
  dry: Blob | null;
  /** El original en seco es el mismo audio que suena (no se guarda dos veces) */
  dryIsAudio?: boolean;
}

interface StoredProject {
  id: 'main';
  tracks: StoredTrack[];
}

const blobs = new WeakMap<AudioBuffer, Blob>();
const packed = new WeakMap<AudioBuffer, Promise<PackedAudio>>();

/** Las pistas importadas (instrumentos separados) se guardan comprimidas; las grabaciones, sin pérdida. */
function toPacked(buf: AudioBuffer): Promise<PackedAudio> {
  let p = packed.get(buf);
  if (!p) {
    p = packAudio(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)), buf.sampleRate);
    packed.set(buf, p);
  }
  return p;
}

function toBlob(buf: AudioBuffer | null): Blob | null {
  if (!buf) return null;
  let b = blobs.get(buf);
  if (!b) {
    b = encodeWav(
      Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)),
      buf.sampleRate
    );
    blobs.set(buf, b);
  }
  return b;
}

export async function saveProject(tracks: StudioTrack[]) {
  const data: StoredProject = {
    id: 'main',
    tracks: await Promise.all(tracks.map(async (t) => ({
      ...t,
      audio: t.lossy && t.audio ? await toPacked(t.audio) : toBlob(t.audio),
      dry: t.dry && t.dry !== t.audio ? toBlob(t.dry) : null,
      dryIsAudio: Boolean(t.dry) && t.dry === t.audio
    })))
  };
  await run('studio', 'readwrite', (s) => s.put(data));
}

export async function loadProject(ctx: BaseAudioContext): Promise<StudioTrack[] | null> {
  const data = await run<StoredProject | undefined>('studio', 'readonly', (s) => s.get('main'));
  if (!data) return null;
  const decode = async (b: Blob | PackedAudio | null) =>
    !b ? null : b instanceof Blob ? ctx.decodeAudioData(await b.arrayBuffer()) : unpackAudio(b, ctx);
  return Promise.all(
    data.tracks.map(async ({ dryIsAudio, ...t }) => {
      const audio = await decode(t.audio);
      const dry = dryIsAudio ? audio : await decode(t.dry);
      return { ...t, audio, dry };
    })
  );
}
