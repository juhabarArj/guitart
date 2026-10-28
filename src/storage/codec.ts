// Compresión de pistas largas (instrumentos separados) con Opus nativo del navegador (WebCodecs).
// Guardamos los paquetes Opus tal cual, sin contenedor, y los decodificamos con AudioDecoder.
// Si el navegador no tiene WebCodecs, se guarda en PCM de 16 bits.

export interface PackedAudio {
  codec: 'opus' | 'pcm16';
  sampleRate: number;
  channels: number;
  /** Muestras por canal del audio original (para recortar el retardo del códec al decodificar) */
  frames: number;
  chunks?: { t: number; d: ArrayBuffer }[];
  description?: ArrayBuffer;
  pcm?: ArrayBuffer;
  /** Muestras de retardo del códec al principio, a descartar al decodificar */
  skip?: number;
}

const BLOCK = 4800;

async function opusSupported(sampleRate: number, channels: number) {
  if (typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined') return false;
  try {
    const cfg = { codec: 'opus', sampleRate, numberOfChannels: channels, bitrate: 160_000 };
    return !!(await AudioEncoder.isConfigSupported(cfg)).supported;
  } catch {
    return false;
  }
}

const delays = new Map<string, Promise<number>>();

/**
 * El retardo inicial del códec depende del navegador y de la frecuencia: se mide una vez comprimiendo
 * un clic en una posición conocida y viendo dónde aparece al descomprimir.
 */
function codecDelay(sampleRate: number, nch: number): Promise<number> {
  const key = `${sampleRate}:${nch}`;
  let p = delays.get(key);
  if (!p) {
    p = (async () => {
      const n = sampleRate;
      const at = Math.round(sampleRate * 0.4);
      const chans = Array.from({ length: nch }, () => {
        const c = new Float32Array(n);
        for (let i = 0; i < 64; i++) c[at + i] = Math.sin((Math.PI * i) / 64) * 0.9;
        return c;
      });
      const packed = await encodeOpus(chans, sampleRate);
      const { data, rate } = await decodeOpus({ ...packed, skip: 0 });
      let peak = 0;
      let idx = at;
      data[0].forEach((v, i) => {
        if (Math.abs(v) > peak) {
          peak = Math.abs(v);
          idx = i;
        }
      });
      // El pico del clic está a mitad de sus 64 muestras; el descompresor puede devolver otra frecuencia
      return Math.max(0, Math.round(idx - ((at + 32) * rate) / sampleRate));
    })();
    delays.set(key, p);
  }
  return p;
}

export async function packAudio(channels: Float32Array[], sampleRate: number): Promise<PackedAudio> {
  const nch = channels.length;
  const frames = channels[0]?.length ?? 0;
  if (!(await opusSupported(sampleRate, nch))) {
    const pcm = new Int16Array(frames * nch);
    for (let i = 0; i < frames; i++)
      for (let c = 0; c < nch; c++) pcm[i * nch + c] = Math.max(-1, Math.min(1, channels[c][i])) * 0x7fff;
    return { codec: 'pcm16', sampleRate, channels: nch, frames, pcm: pcm.buffer };
  }
  const packed = await encodeOpus(channels, sampleRate);
  return { ...packed, skip: await codecDelay(sampleRate, nch) };
}

async function encodeOpus(channels: Float32Array[], sampleRate: number): Promise<PackedAudio> {
  const nch = channels.length;
  const frames = channels[0]?.length ?? 0;
  const chunks: { t: number; d: ArrayBuffer }[] = [];
  let description: ArrayBuffer | undefined;
  let failure: unknown = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const d = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(d);
      chunks.push({ t: chunk.timestamp, d });
      const desc = meta?.decoderConfig?.description;
      if (desc && !description) description = desc instanceof ArrayBuffer ? desc.slice(0) : new Uint8Array(desc as ArrayBufferView as Uint8Array).buffer.slice(0);
    },
    error: (e) => (failure = e)
  });
  enc.configure({ codec: 'opus', sampleRate, numberOfChannels: nch, bitrate: 160_000 });
  for (let o = 0; o < frames; o += BLOCK) {
    const n = Math.min(BLOCK, frames - o);
    const planar = new Float32Array(n * nch);
    for (let c = 0; c < nch; c++) planar.set(channels[c].subarray(o, o + n), c * n);
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: n,
      numberOfChannels: nch,
      timestamp: Math.round((o / sampleRate) * 1e6),
      data: planar
    });
    enc.encode(data);
    data.close();
    // Deja respirar a la interfaz y no acumula demasiados bloques pendientes
    if (enc.encodeQueueSize > 50) await new Promise((r) => setTimeout(r, 0));
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
  return { codec: 'opus', sampleRate, channels: nch, frames, chunks, description };
}

export async function unpackAudio(p: PackedAudio, ctx: BaseAudioContext): Promise<AudioBuffer> {
  if (p.codec === 'pcm16') {
    const out = Array.from({ length: p.channels }, () => new Float32Array(p.frames));
    const pcm = new Int16Array(p.pcm!);
    for (let i = 0; i < p.frames; i++) for (let c = 0; c < p.channels; c++) out[c][i] = pcm[i * p.channels + c] / 0x7fff;
    const buf = ctx.createBuffer(p.channels, Math.max(1, p.frames), p.sampleRate);
    out.forEach((c, i) => buf.copyToChannel(c, i));
    return buf;
  }
  // Opus se descomprime siempre a su frecuencia interna (48 kHz): la pista se crea a esa frecuencia
  const { data, rate } = await decodeOpus(p);
  const frames = Math.round((p.frames * rate) / p.sampleRate);
  const buf = ctx.createBuffer(p.channels, Math.max(1, frames), rate);
  data.forEach((c, i) => buf.copyToChannel(new Float32Array(c.subarray(0, frames)), i));
  return buf;
}

/** Decodifica los paquetes Opus y descarta el retardo inicial del códec. */
async function decodeOpus(p: PackedAudio): Promise<{ data: Float32Array[]; rate: number }> {
  {
    const parts: Float32Array[][] = [];
    let rate = p.sampleRate;
    let failure: unknown = null;
    const dec = new AudioDecoder({
      output: (data) => {
        rate = data.sampleRate;
        const per = Array.from({ length: p.channels }, (_, c) => {
          const a = new Float32Array(data.numberOfFrames);
          data.copyTo(a, { planeIndex: c, format: 'f32-planar' });
          return a;
        });
        parts.push(per);
        data.close();
      },
      error: (e) => (failure = e)
    });
    dec.configure({ codec: 'opus', sampleRate: p.sampleRate, numberOfChannels: p.channels, ...(p.description ? { description: p.description } : {}) });
    for (const c of p.chunks ?? []) dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: c.t, data: c.d }));
    await dec.flush();
    dec.close();
    if (failure) throw failure;
    const total = parts.reduce((n, x) => n + x[0].length, 0);
    const skip = Math.min(p.skip ?? 0, total);
    const res = Array.from({ length: p.channels }, () => new Float32Array(Math.max(0, total - skip)));
    let o = -skip;
    for (const per of parts) {
      for (let c = 0; c < p.channels; c++) {
        const from = Math.max(0, -o);
        if (from < per[c].length) res[c].set(per[c].subarray(from), o + from);
      }
      o += per[0].length;
    }
    return { data: res, rate };
  }
}

/** Tamaño aproximado en bytes. */
export const packedSize = (p: PackedAudio) =>
  p.codec === 'pcm16' ? p.pcm!.byteLength : (p.chunks ?? []).reduce((n, c) => n + c.d.byteLength, 0);
