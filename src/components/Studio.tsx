import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardState } from '../audio/chain';
import type { IrLoader } from '../audio/effects';
import type { AudioEngine, RecordSource } from '../audio/engine';
import { renderMix, type StudioTrack } from '../audio/studio';
import { encodeWav } from '../audio/wav';
import { listRecordings, saveRecording, type Recording } from '../storage/recordings';
import { loadProject, saveProject } from '../storage/studio';

interface Props {
  engine: AudioEngine;
  active: boolean;
  latencyMs: number;
  busy: boolean; // la grabadora de la otra pestaña está grabando
  onBusy: (on: boolean) => void;
  board: BoardState;
  irLoaderFor: (ctx: BaseAudioContext) => IrLoader;
  onTakeSaved: () => void;
  theme: string;
}

type Mode = 'idle' | 'playing' | 'recording' | 'working';

const newTrack = (n: number): StudioTrack => ({
  id: crypto.randomUUID(),
  name: `Pista ${n}`,
  volume: 0.9,
  pan: 0,
  mute: false,
  solo: false,
  source: 'guitar',
  start: 0,
  audio: null,
  dry: null,
  reamped: false
});

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

const PREFS_KEY = 'guitart:studio';
function loadPrefs() {
  try {
    return { useTempo: false, countIn: 1, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { useTempo: false, countIn: 1 };
  }
}

function bufferFrom(ctx: BaseAudioContext, channels: Float32Array[], sampleRate: number) {
  const buf = ctx.createBuffer(channels.length, Math.max(1, channels[0].length), sampleRate);
  channels.forEach((c, i) => buf.copyToChannel(new Float32Array(c), i));
  return buf;
}

const channelsOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));

function drawLane(canvas: HTMLCanvasElement, track: StudioTrack, total: number) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const css = getComputedStyle(canvas);
  g.clearRect(0, 0, w, h);
  // Marcas de segundos
  g.fillStyle = css.getPropertyValue('--edge');
  for (let s = 1; s < total; s++) {
    const x = Math.round((s / total) * w);
    g.globalAlpha = s % 5 === 0 ? 0.9 : 0.35;
    g.fillRect(x, 0, 1, h);
  }
  g.globalAlpha = 1;
  const a = track.audio;
  if (!a) return;
  const x0 = (track.start / total) * w;
  const x1 = ((track.start + a.duration) / total) * w;
  const color = css.getPropertyValue(track.reamped ? '--tuned' : '--amber');
  g.fillStyle = color;
  g.globalAlpha = 0.14;
  g.fillRect(x0, 2, x1 - x0, h - 4);
  g.globalAlpha = 1;
  const data = a.getChannelData(0);
  const mid = h / 2;
  const per = data.length / Math.max(1, x1 - x0);
  for (let x = Math.floor(x0); x < x1; x++) {
    const from = Math.floor((x - x0) * per);
    const to = Math.min(data.length, Math.floor((x - x0 + 1) * per));
    let peak = 0;
    for (let i = from; i < to; i += 4) peak = Math.max(peak, Math.abs(data[i]));
    const y = Math.max(1, Math.min(1, peak * 1.6) * (mid - 3));
    g.fillRect(x, mid - y, 1, y * 2);
  }
}

export function Studio({ engine, active, latencyMs, busy, onBusy, board, irLoaderFor, onTakeSaved, theme }: Props) {
  const [tracks, setTracks] = useState<StudioTrack[]>(() => [1, 2, 3, 4].map(newTrack));
  const [loaded, setLoaded] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [pos, setPos] = useState(0);
  const [mode, setMode] = useState<Mode>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState(loadPrefs);
  const [takes, setTakes] = useState<Recording[] | null>(null);
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const heads = useRef(new Map<string, HTMLDivElement>());
  const timeRef = useRef<HTMLSpanElement>(null);
  const recInfo = useRef<{ trackId: string; startPos: number; source: RecordSource; prevSource: RecordSource } | null>(null);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  const setPrefs = (p: Partial<typeof prefs>) =>
    setPrefsState((old: typeof prefs) => {
      const next = { ...old, ...p };
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      return next;
    });

  // Cargar el proyecto guardado
  useEffect(() => {
    if (!engine.ctx) return;
    loadProject(engine.ctx)
      .then((t) => {
        if (t?.length) setTracks(t);
      })
      .catch(() => setMessage('No se ha podido cargar el proyecto guardado.'))
      .finally(() => setLoaded(true));
  }, [engine]);

  // Guardar con un pequeño retardo tras cada cambio
  useEffect(() => {
    if (!loaded || mode === 'recording') return;
    const id = window.setTimeout(() => saveProject(tracks).catch(() => setMessage('No se ha podido guardar el proyecto.')), 600);
    return () => window.clearTimeout(id);
  }, [tracks, loaded, mode]);

  useEffect(() => engine.studio.updateMix(tracks), [engine, tracks]);

  const end = Math.max(0, ...tracks.filter((t) => t.audio).map((t) => t.start + t.audio!.duration));
  const total = Math.max(20, Math.ceil(end + 4));

  // Dibujo de las ondas (también al cambiar tamaño o tema)
  const redraw = useCallback(() => {
    for (const t of tracksRef.current) {
      const c = canvases.current.get(t.id);
      if (c) drawLane(c, t, total);
    }
  }, [total]);
  useEffect(() => {
    if (!active) return;
    redraw();
    const ro = new ResizeObserver(redraw);
    canvases.current.forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [active, redraw, tracks, theme]);

  const update = (id: string, patch: Partial<StudioTrack>) =>
    setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  // Cabezal de reproducción
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      const p = mode === 'idle' || mode === 'working' ? pos : engine.studio.playing ? engine.studio.position() : pos;
      heads.current.forEach((el) => el && (el.style.left = `${Math.min(100, (p / total) * 100)}%`));
      if (timeRef.current) timeRef.current.textContent = clock(p);
      if (mode === 'playing' && p > end + 0.3 && !engine.transport.playing) stop();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  const play = () => {
    const ctx = engine.ctx;
    if (!ctx) return;
    const at = ctx.currentTime + 0.1;
    if (prefs.useTempo) engine.transport.run(at - pos, 0);
    engine.studio.play(tracks, pos, at);
    setMode('playing');
  };

  const record = () => {
    const ctx = engine.ctx;
    const track = tracks.find((t) => t.id === armed);
    if (!ctx || !track) return;
    if (track.audio && !window.confirm(`«${track.name}» ya tiene audio. ¿Grabar encima y sustituirlo?`)) return;
    const countIn = prefs.useTempo ? prefs.countIn * engine.transport.barDur : 0;
    const at = ctx.currentTime + 0.15 + countIn;
    const prevSource = engine.recordSource;
    engine.setRecordSource(track.source);
    if (prefs.useTempo) engine.transport.run(at - pos, at);
    engine.startRecording(at);
    engine.studio.play(tracks, pos, at, track.id);
    recInfo.current = { trackId: track.id, startPos: pos, source: track.source, prevSource };
    onBusy(true);
    setMode('recording');
    setMessage(countIn ? 'Cuenta atrás… la grabación empieza al terminar.' : null);
  };

  const stop = async () => {
    const ctx = engine.ctx;
    const wasRecording = mode === 'recording';
    const p = engine.studio.position();
    engine.studio.stop();
    engine.transport.stop();
    if (!wasRecording || !ctx || !recInfo.current) {
      setPos(Math.min(p, total));
      setMode('idle');
      return;
    }
    setMode('working');
    const info = recInfo.current;
    recInfo.current = null;
    try {
      const { channels, sampleRate } = await engine.stopRecording();
      // Lo que entra se tocó escuchando la reproducción "latencia" ms antes: se adelanta la toma
      const lat = Math.round((latencyMs / 1000) * sampleRate);
      const trimmed = channels.map((c) => c.subarray(Math.min(lat, Math.max(0, c.length - 1))));
      if (trimmed[0].length < sampleRate * 0.1) throw new Error('corta');
      const buf = bufferFrom(ctx, trimmed, sampleRate);
      update(info.trackId, { audio: buf, dry: info.source === 'dry' ? buf : null, start: info.startPos, reamped: false });
      setMessage(null);
    } catch {
      setMessage('La toma es demasiado corta o no se ha podido guardar.');
    } finally {
      engine.setRecordSource(info.prevSource);
      onBusy(false);
      setMode('idle');
    }
  };

  const reamp = async (t: StudioTrack) => {
    const ctx = engine.ctx;
    if (!ctx || !t.dry) return;
    setMode('working');
    setMessage(`Procesando «${t.name}» con la pedalera actual…`);
    try {
      const out = await engine.reamp(channelsOf(t.dry), t.dry.sampleRate, board, irLoaderFor);
      update(t.id, { audio: bufferFrom(ctx, out, t.dry.sampleRate), reamped: true });
      setMessage(null);
    } catch {
      setMessage('No se ha podido hacer el re-amp.');
    } finally {
      setMode('idle');
    }
  };

  const importTake = async (t: StudioTrack, takeId: string) => {
    const take = takes?.find((x) => x.id === takeId);
    if (!take || !engine.ctx) return;
    if (t.audio && !window.confirm(`¿Sustituir el audio de «${t.name}» por «${take.name}»?`)) return;
    const buf = await engine.ctx.decodeAudioData(await take.blob.arrayBuffer());
    update(t.id, { audio: buf, dry: take.source === 'dry' || !take.source ? buf : null, start: 0, reamped: false });
  };

  const exportMix = async () => {
    const ctx = engine.ctx;
    if (!ctx) return;
    setMode('working');
    try {
      const mix = await renderMix(tracks, ctx.sampleRate);
      if (!mix) return;
      const all = await listRecordings();
      const n = all.filter((r) => r.name.startsWith('Mezcla del estudio')).length + 1;
      const rec: Recording = {
        id: crypto.randomUUID(),
        name: `Mezcla del estudio ${n}`,
        createdAt: Date.now(),
        duration: mix.duration,
        sampleRate: mix.sampleRate,
        channels: 2,
        source: 'wet',
        blob: encodeWav(channelsOf(mix), mix.sampleRate)
      };
      await saveRecording(rec);
      onTakeSaved();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(rec.blob);
      a.download = `${rec.name}.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setMessage(`«${rec.name}» descargada y guardada en Grabación.`);
    } finally {
      setMode('idle');
    }
  };

  const idle = mode === 'idle';
  const hasAudio = tracks.some((t) => t.audio);

  return (
    <section className="panel studio-panel" aria-labelledby="studio-title" data-mode={mode}>
      <div className="panel-head wrap">
        <h2 id="studio-title">Multipista</h2>
        <div className="studio-transport">
          <button className="btn" onClick={() => setPos(0)} disabled={!idle} aria-label="Volver al inicio">
            ⏮
          </button>
          {mode === 'playing' || mode === 'recording' ? (
            <button className="btn primary-soft" onClick={stop}>
              Parar
            </button>
          ) : (
            <button className="btn" onClick={play} disabled={!idle || !hasAudio}>
              Reproducir
            </button>
          )}
          <button
            className={`rec-button small${mode === 'recording' ? ' is-recording' : ''}`}
            onClick={mode === 'recording' ? stop : record}
            disabled={(!idle && mode !== 'recording') || !armed || (busy && mode !== 'recording')}
          >
            <span className="rec-dot" aria-hidden="true" />
            {mode === 'recording' ? 'Detener' : 'Grabar'}
          </button>
          <span className="studio-time" ref={timeRef}>
            0:00.0
          </span>
        </div>
      </div>

      <div className="studio-options">
        <label className="check">
          <input type="checkbox" checked={prefs.useTempo} onChange={(e) => setPrefs({ useTempo: e.target.checked })} />
          <span>
            Tocar con el tempo
            <small>Metrónomo y batería de la pestaña Looper y ritmo, alineados con el proyecto.</small>
          </span>
        </label>
        <label className="field inline">
          <span>Cuenta atrás al grabar</span>
          <select value={prefs.countIn} disabled={!prefs.useTempo} onChange={(e) => setPrefs({ countIn: Number(e.target.value) })}>
            <option value={0}>Sin cuenta</option>
            <option value={1}>1 compás</option>
            <option value={2}>2 compases</option>
          </select>
        </label>
        <button className="btn" onClick={exportMix} disabled={!idle || !hasAudio}>
          Exportar mezcla (WAV)
        </button>
      </div>

      {message && <p className="notice">{message}</p>}
      {!armed && <p className="hint">Elige «Grabar aquí» en una pista para poder grabar.</p>}

      <div className="tracks">
        {tracks.map((t) => (
          <div key={t.id} className={`track${armed === t.id ? ' armed' : ''}`}>
            <div className="track-controls">
              <div className="track-row">
                <input
                  className="track-name"
                  value={t.name}
                  maxLength={30}
                  onChange={(e) => update(t.id, { name: e.target.value })}
                  aria-label="Nombre de la pista"
                />
                <button
                  className={`toggle rec${armed === t.id ? ' on' : ''}`}
                  aria-pressed={armed === t.id}
                  disabled={!idle}
                  onClick={() => setArmed(armed === t.id ? null : t.id)}
                  title="Grabar en esta pista"
                >
                  Grabar aquí
                </button>
                <button className={`toggle${t.mute ? ' on' : ''}`} aria-pressed={t.mute} onClick={() => update(t.id, { mute: !t.mute })} title="Silenciar">
                  M
                </button>
                <button className={`toggle${t.solo ? ' on' : ''}`} aria-pressed={t.solo} onClick={() => update(t.id, { solo: !t.solo })} title="Solo">
                  S
                </button>
              </div>
              <div className="track-row sliders">
                <label>
                  <span>Vol</span>
                  <input type="range" min={0} max={1.5} step={0.01} value={t.volume} onChange={(e) => update(t.id, { volume: Number(e.target.value) })} />
                </label>
                <label>
                  <span>Pan</span>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.05}
                    value={t.pan}
                    onChange={(e) => update(t.id, { pan: Number(e.target.value) })}
                    onDoubleClick={() => update(t.id, { pan: 0 })}
                  />
                </label>
              </div>
              <div className="track-row">
                <select
                  value={t.source}
                  disabled={!idle}
                  onChange={(e) => update(t.id, { source: e.target.value as StudioTrack['source'] })}
                  aria-label="Qué se graba en esta pista"
                >
                  <option value="guitar">Grabar con efectos</option>
                  <option value="dry">Grabar en seco</option>
                </select>
                <select
                  value=""
                  disabled={!idle}
                  onFocus={() => listRecordings().then(setTakes)}
                  onChange={(e) => importTake(t, e.target.value)}
                  aria-label="Importar una toma"
                >
                  <option value="">Importar toma…</option>
                  {takes?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              {t.audio && (
                <div className="track-row">
                  {t.dry && !t.reamped && (
                    <button className="btn small" disabled={!idle} onClick={() => reamp(t)}>
                      Re-amp
                    </button>
                  )}
                  {t.reamped && (
                    <>
                      <button className="btn small" disabled={!idle} onClick={() => reamp(t)}>
                        Repetir re-amp
                      </button>
                      <button className="btn small ghost" disabled={!idle} onClick={() => update(t.id, { audio: t.dry, reamped: false })}>
                        Original
                      </button>
                    </>
                  )}
                  <button
                    className="btn small ghost danger"
                    disabled={!idle}
                    onClick={() => window.confirm(`¿Vaciar «${t.name}»?`) && update(t.id, { audio: null, dry: null, reamped: false })}
                  >
                    Vaciar
                  </button>
                </div>
              )}
            </div>
            <div
              className="lane"
              onClick={(e) => {
                if (!idle) return;
                const r = e.currentTarget.getBoundingClientRect();
                setPos(Math.max(0, ((e.clientX - r.left) / r.width) * total));
              }}
              title="Haz clic para mover el cabezal"
            >
              <canvas ref={(el) => (el ? canvases.current.set(t.id, el) : canvases.current.delete(t.id))} />
              <div className="playhead" ref={(el) => (el ? heads.current.set(t.id, el) : heads.current.delete(t.id))} />
              {t.reamped && <span className="lane-tag">Re-amp</span>}
            </div>
          </div>
        ))}
      </div>

      <details className="help guide">
        <summary>Cómo funciona el multipista</summary>
        <ol>
          <li>
            Marca <strong>Grabar aquí</strong> en una pista y pulsa <strong>Grabar</strong>. Las demás pistas suenan mientras
            tocas, para que grabes encima de ellas.
          </li>
          <li>
            Haz clic en la línea de tiempo para empezar desde otro punto. Grabar en una pista con audio lo sustituye.
          </li>
          <li>
            Ajusta volumen y panorama de cada pista. <strong>M</strong> la silencia y <strong>S</strong> deja sonar solo las
            pistas marcadas.
          </li>
          <li>
            <strong>Exportar mezcla</strong> crea un WAV con todo y lo guarda también en la lista de Grabación.
          </li>
        </ol>
        <p>
          <strong>Re-amp:</strong> si grabas una pista <em>en seco</em>, se guarda la guitarra limpia. Después puedes
          probar otros sonidos con la pedalera y pulsar <strong>Re-amp</strong>: la pista se procesa con la pedalera
          actual sin volver a tocar. <strong>Original</strong> vuelve al sonido limpio. También funciona con tomas en
          seco importadas desde Grabación.
        </p>
        <p>
          Las tomas se alinean con la latencia medida en Afinador y audio. El proyecto se guarda solo en este navegador.
        </p>
      </details>
    </section>
  );
}
