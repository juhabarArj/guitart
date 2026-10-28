import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { encodeWav } from '../audio/wav';
import { MODEL_MB, MODEL_URL, SEP_RATE, Separator, STEM_NAMES, type Stem, type StemId } from '../separate/separator';
import { packAudio, packedSize, unpackAudio } from '../storage/codec';
import { saveSong, type Song } from '../storage/songs';
import { analyzeOnsets, estimateBeatOffset, estimateBpmFromTimes, strongOnsetSeconds, toMono } from '../tab/transcribe';

export interface StudioImport {
  n: number;
  name: string;
  stems: { name: string; buffer: AudioBuffer }[];
  bpm: number | null;
  offset: number;
}

type Phase = 'idle' | 'loading' | 'separating' | 'done' | 'error';
interface Track {
  mute: boolean;
  solo: boolean;
  volume: number;
}
const ORDER: StemId[] = ['drums', 'bass', 'vocals', 'other'];
const fresh = (): Record<StemId, Track> =>
  Object.fromEntries(ORDER.map((id) => [id, { mute: false, solo: false, volume: 1 }])) as Record<StemId, Track>;
const mb = (b: number) => (b / 1024 / 1024).toFixed(0);
const mmss = (s: number) => `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;

const separator = new Separator();

interface Props {
  engine: AudioEngine;
  song: Song;
  onSongUpdate: (s: Song) => void;
  onToStudio: (req: Omit<StudioImport, 'n'>) => void;
}

export function SeparationPanel({ engine, song, onSongUpdate, onToStudio }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [cached, setCached] = useState<boolean | null>(null);
  const [stats, setStats] = useState<{ seconds: number; audio: number; gpu: boolean; threads: number } | null>(null);
  const [stems, setStems] = useState<Stem[] | null>(null);
  const [stemRate, setStemRate] = useState(SEP_RATE);
  const [savedInfo, setSavedInfo] = useState<string | null>(null);
  const songRef = useRef(song);
  songRef.current = song;
  const [mix, setMix] = useState<Record<StemId, Track>>(fresh);
  const [usingMix, setUsingMix] = useState(false);
  const modelFile = useRef<HTMLInputElement>(null);
  const started = useRef(0);
  const [gpuHere, setGpuHere] = useState<boolean | null>(null);

  useEffect(() => {
    separator.isCached().then(setCached).catch(() => setCached(false));
    // El navegador puede anunciar WebGPU pero no dar acceso a la tarjeta: se comprueba de verdad
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    if (!nav.gpu) setGpuHere(false);
    else nav.gpu.requestAdapter().then((a) => setGpuHere(!!a)).catch(() => setGpuHere(false));
  }, []);

  // Las pistas pertenecen a la canción: al cambiar de canción se cargan las guardadas (si las hay)
  useEffect(() => {
    setStems(null);
    setStats(null);
    setSavedInfo(null);
    setPhase('idle');
    setMix(fresh());
    setUsingMix(false);
    const saved = song.stems;
    if (!saved?.length || !engine.ctx) return;
    let cancelled = false;
    setMsg('Cargando las pistas separadas guardadas…');
    Promise.all(saved.map(async (x) => ({ id: x.id, buf: await unpackAudio(x.audio, engine.ctx!) })))
      .then((list) => {
        if (cancelled) return;
        setStems(list.map(({ id, buf }) => ({ id, left: buf.getChannelData(0), right: buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0) })));
        setStemRate(list[0].buf.sampleRate);
        const mbTotal = saved.reduce((n, x) => n + packedSize(x.audio), 0) / 1024 / 1024;
        setSavedInfo(`Pistas guardadas de una separación anterior (${mbTotal.toFixed(1)} MB).`);
        setPhase('done');
        setMsg(null);
      })
      .catch(() => !cancelled && setMsg('No se han podido leer las pistas guardadas. Vuelve a separar la canción.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id]);

  /** Tras separar: muestra el mezclador, calcula el tempo con la batería y guarda las pistas comprimidas. */
  const finish = async (result: Stem[], rate: number, seconds: number | null, backend: { gpu: boolean; threads: number } | null) => {
    const audioSeconds = result[0].left.length / rate;
    if (seconds != null && backend) setStats({ seconds, audio: audioSeconds, ...backend });
    setStems(result);
    setStemRate(rate);
    setMix(fresh());
    setUsingMix(true);
    setPhase('done');
    try {
      setMsg('Calculando el tempo con la batería…');
      const drums = result.find((x) => x.id === 'drums')!;
      const onsets = strongOnsetSeconds(await analyzeOnsets(toMono([drums.left, drums.right]), rate, 0.5), rate);
      const bpm = onsets.length >= 8 ? estimateBpmFromTimes(onsets) : songRef.current.bpm;
      const tempoOffset = bpm ? estimateBeatOffset(onsets, bpm) : 0;
      setMsg('Guardando las pistas comprimidas…');
      const packed = [];
      for (const x of result) packed.push({ id: x.id, audio: await packAudio([x.left, x.right], rate) });
      const next: Song = { ...songRef.current, stems: packed, bpm: bpm ?? songRef.current.bpm, tempoOffset };
      await saveSong(next);
      onSongUpdate(next);
      const mbTotal = packed.reduce((n, x) => n + packedSize(x.audio), 0) / 1024 / 1024;
      setSavedInfo(`Pistas guardadas (${mbTotal.toFixed(1)} MB). Tempo según la batería: ${bpm ?? '—'} BPM.`);
      setMsg(null);
    } catch {
      setMsg('Las pistas no se han podido guardar (¿falta espacio?). Se pueden usar hasta que cambies de canción.');
    }
  };

  // Modo depuración (?debug): permite probar todo el flujo sin el modelo, con pistas generadas
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('debug')) return;
    const w = window as unknown as { __guitartStems?: unknown; __guitartCodec?: unknown };
    w.__guitartStems = (list: Stem[], rate: number) => finish(list, rate, 1, { gpu: false, threads: 1 });
    w.__guitartCodec = { packAudio, unpackAudio };
  });

  // Mezcla según silencio, solo y volumen, y se cambia en el reproductor sin perder la posición
  useEffect(() => {
    if (!stems || !usingMix) return;
    const id = window.setTimeout(() => {
      const anySolo = ORDER.some((k) => mix[k].solo);
      const n = stems[0].left.length;
      const L = new Float32Array(n);
      const R = new Float32Array(n);
      for (const s of stems) {
        const t = mix[s.id];
        const g = (anySolo ? t.solo : !t.mute) ? t.volume : 0;
        if (!g) continue;
        for (let i = 0; i < n; i++) {
          L[i] += s.left[i] * g;
          R[i] += s.right[i] * g;
        }
      }
      engine.song.swap(encodeWav([L, R], stemRate, 16));
    }, 250);
    return () => window.clearTimeout(id);
  }, [mix, stems, usingMix, engine, stemRate]);

  const run = async (source?: ArrayBuffer) => {
    if (!engine.ctx) return;
    setStats(null);
    setProgress(0);
    separator.events = {
      onDownload: (loaded, total, wasCached) => {
        setProgress(loaded / total);
        setMsg(wasCached ? 'Modelo cargado desde la caché.' : `Descargando el modelo: ${mb(loaded)} de ${mb(total)} MB…`);
      },
      onLog: (m) => setMsg(m),
      onProgress: (p, seg, total) => {
        setProgress(p);
        const elapsed = (performance.now() - started.current) / 1000;
        const eta = p > 0 ? (elapsed / p) * (1 - p) : 0;
        setMsg(`Separando: fragmento ${seg} de ${total}${p > 0.02 ? ` · quedan unos ${mmss(eta)}` : ''}`);
      }
    };
    try {
      setPhase('loading');
      setMsg('Preparando…');
      const backend = await separator.load(source ?? MODEL_URL);
      setCached(true);
      setPhase('separating');
      setProgress(0);
      setMsg('Preparando la canción…');
      // El modelo trabaja a 44,1 kHz en estéreo
      const decoded = await engine.ctx.decodeAudioData(await song.blob.arrayBuffer());
      const off = new OfflineAudioContext(2, Math.ceil(decoded.duration * SEP_RATE), SEP_RATE);
      const src = new AudioBufferSourceNode(off, { buffer: decoded });
      src.connect(off.destination);
      src.start();
      const st = await off.startRendering();
      started.current = performance.now();
      const result = await separator.separate(new Float32Array(st.getChannelData(0)), new Float32Array(st.getChannelData(1)));
      const seconds = (performance.now() - started.current) / 1000;
      await finish(result, SEP_RATE, seconds, backend);
    } catch (e) {
      setPhase('error');
      const text = e instanceof Error ? e.message : String(e);
      console.warn('Separación:', text);
      setMsg(
        /^descarga|Failed to fetch|NetworkError|network error/i.test(text) && !(source instanceof ArrayBuffer)
          ? 'No se ha podido descargar el modelo. Comprueba la conexión, o descárgalo a mano y elígelo con «Usar un archivo del modelo».'
          : /memory|memoria|allocation|OOM/i.test(text)
            ? 'El navegador se ha quedado sin memoria. Prueba con una canción más corta o cierra otras pestañas.'
            : `La separación ha fallado: ${text}`
      );
    }
  };

  const setTrack = (id: StemId, patch: Partial<Track>) => {
    setUsingMix(true);
    setMix((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  };

  const busy = phase === 'loading' || phase === 'separating';
  const speed = stats ? stats.audio / stats.seconds : 0;

  return (
    <div className="separation">
      <div className="separation-head">
        <h3>Separar instrumentos</h3>
        <span className="badge">Prueba</span>
      </div>

      {phase !== 'done' && (
        <>
          <p className="hint">
            Divide la canción en batería, bajo, voz y resto (guitarras, teclados…) para silenciar lo que quieras y tocar tú esa
            parte. Usa el modelo de IA Demucs dentro del navegador: la canción no sale de tu equipo.
          </p>
          <ul className="sep-checks">
            <li className={gpuHere ? 'ok' : gpuHere === false ? 'warn' : undefined}>
              {gpuHere == null
                ? 'Comprobando la aceleración gráfica…'
                : gpuHere
                  ? 'Aceleración gráfica (WebGPU) disponible en este navegador.'
                  : 'Sin aceleración gráfica (WebGPU): funcionará, pero mucho más lento. En PC, Chrome o Edge actualizados suelen tenerla.'}
            </li>
            <li>
              {cached ? 'Modelo ya descargado.' : `La primera vez descarga el modelo (${MODEL_MB} MB) y lo guarda para las siguientes.`}
            </li>
            <li>Necesita bastante memoria: pensado para ordenador; en el móvil puede no funcionar.</li>
          </ul>
          <div className="control-buttons">
            <button className="btn primary-soft" onClick={() => run()} disabled={busy}>
              {busy ? 'Trabajando…' : cached ? 'Separar instrumentos' : `Descargar modelo y separar`}
            </button>
            <button className="btn ghost small" onClick={() => modelFile.current?.click()} disabled={busy}>
              Usar un archivo del modelo
            </button>
            <input
              ref={modelFile}
              type="file"
              accept=".onnx"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) run(await f.arrayBuffer());
              }}
            />
          </div>
        </>
      )}

      {(busy || msg) && (
        <div className="sep-progress">
          {busy && (
            <div className="bar">
              <div style={{ transform: `scaleX(${progress})` }} />
            </div>
          )}
          {msg && <p className={phase === 'error' ? 'notice error' : 'hint'}>{msg}</p>}
        </div>
      )}

      {phase === 'done' && stems && (
        <>
          {savedInfo && <p className="hint">{savedInfo}</p>}
          {stats && (
          <p className="notice">
            Separada en {mmss(stats.seconds)} para {mmss(stats.audio)} de canción (
            {speed >= 1 ? `${speed.toFixed(1)} veces más rápido que el tiempo real` : `${(1 / speed).toFixed(1)} veces el tiempo real`}
            ), {stats.gpu ? 'con aceleración gráfica' : `sin aceleración gráfica, ${stats.threads} ${stats.threads === 1 ? 'hilo' : 'hilos'}`}.
          </p>
          )}
          <div className="stems">
            {ORDER.map((id) => (
              <div key={id} className="stem-row">
                <span className="stem-name">{STEM_NAMES[id]}</span>
                <button
                  className={`toggle${mix[id].mute ? ' on' : ''}`}
                  aria-pressed={mix[id].mute}
                  onClick={() => setTrack(id, { mute: !mix[id].mute })}
                  title="Silenciar"
                >
                  M
                </button>
                <button
                  className={`toggle${mix[id].solo ? ' on' : ''}`}
                  aria-pressed={mix[id].solo}
                  onClick={() => setTrack(id, { solo: !mix[id].solo })}
                  title="Solo"
                >
                  S
                </button>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.01}
                  value={mix[id].volume}
                  onChange={(e) => setTrack(id, { volume: Number(e.target.value) })}
                  aria-label={`Volumen de ${STEM_NAMES[id]}`}
                />
              </div>
            ))}
          </div>
          <div className="control-buttons">
            <button
              className="btn small"
              onClick={() => {
                setUsingMix(false);
                setMix(fresh());
                engine.song.swap(song.blob);
              }}
            >
              Volver a la canción original
            </button>
            <button
              className="btn small primary-soft"
              onClick={() => {
                const ctx = engine.ctx;
                if (!ctx) return;
                const toBuffer = (x: Stem) => {
                  const b = ctx.createBuffer(2, x.left.length, stemRate);
                  b.copyToChannel(new Float32Array(x.left), 0);
                  b.copyToChannel(new Float32Array(x.right), 1);
                  return b;
                };
                onToStudio({
                  name: song.name,
                  stems: ORDER.map((id) => ({ name: STEM_NAMES[id].split(' (')[0], buffer: toBuffer(stems.find((x) => x.id === id)!) })),
                  bpm: song.bpm,
                  offset: song.tempoOffset ?? 0
                });
              }}
              title="Crea un proyecto en el Estudio con una pista por instrumento y una pista para grabar tu guitarra"
            >
              Llevar al Estudio
            </button>
            <button className="btn small ghost" onClick={() => run()}>
              Separar otra vez
            </button>
            <button className="btn small ghost" onClick={() => separator.dispose()} title="Libera la memoria del modelo hasta la próxima separación">
              Liberar memoria
            </button>
          </div>
          <p className="hint">
            La velocidad y el bucle siguen funcionando con la mezcla. Las pistas se guardan comprimidas con la canción: la
            próxima vez se cargan sin volver a separar.
          </p>
        </>
      )}
    </div>
  );
}
