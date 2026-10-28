import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { encodeWav } from '../audio/wav';
import { MODEL_MB, MODEL_URL, SEP_RATE, Separator, STEM_NAMES, type Stem, type StemId } from '../separate/separator';
import type { Song } from '../storage/songs';

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

export function SeparationPanel({ engine, song }: { engine: AudioEngine; song: Song }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [cached, setCached] = useState<boolean | null>(null);
  const [stats, setStats] = useState<{ seconds: number; audio: number; gpu: boolean; threads: number } | null>(null);
  const [stems, setStems] = useState<Stem[] | null>(null);
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

  // Las pistas pertenecen a la canción: al cambiar de canción se descartan
  useEffect(() => {
    setStems(null);
    setStats(null);
    setPhase('idle');
    setMix(fresh());
    setUsingMix(false);
  }, [song.id]);

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
      engine.song.swap(encodeWav([L, R], SEP_RATE, 16));
    }, 250);
    return () => window.clearTimeout(id);
  }, [mix, stems, usingMix, engine]);

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
      setStats({ seconds, audio: decoded.duration, ...backend });
      setStems(result);
      setMix(fresh());
      setUsingMix(true);
      setPhase('done');
      setMsg(null);
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

      {phase === 'done' && stems && stats && (
        <>
          <p className="notice">
            Separada en {mmss(stats.seconds)} para {mmss(stats.audio)} de canción (
            {speed >= 1 ? `${speed.toFixed(1)} veces más rápido que el tiempo real` : `${(1 / speed).toFixed(1)} veces el tiempo real`}
            ), {stats.gpu ? 'con aceleración gráfica' : `sin aceleración gráfica, ${stats.threads} ${stats.threads === 1 ? 'hilo' : 'hilos'}`}.
          </p>
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
            <button className="btn small ghost" onClick={() => run()}>
              Separar otra vez
            </button>
            <button className="btn small ghost" onClick={() => separator.dispose()} title="Libera la memoria del modelo hasta la próxima separación">
              Liberar memoria
            </button>
          </div>
          <p className="hint">
            La velocidad y el bucle siguen funcionando con la mezcla. En esta prueba las pistas no se guardan: al cambiar de
            canción o recargar hay que volver a separar.
          </p>
        </>
      )}
    </div>
  );
}
