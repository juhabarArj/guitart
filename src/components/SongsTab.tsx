import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { useAction, type Register } from '../control/registry';
import { deleteSong, listSongs, saveSong, type Song } from '../storage/songs';
import { analyzeOnsets, estimateBpmFromTimes, onsetSeconds, toMono } from '../tab/transcribe';

const MAX_MB = 60;
const clock = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
const clockTenths = (s: number) => `${clock(s)}.${Math.floor((s % 1) * 10)}`;

function peaksOf(buf: AudioBuffer, columns = 800): number[] {
  const ch = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const per = Math.max(1, Math.floor(buf.length / columns));
  const out: number[] = [];
  for (let k = 0; k < columns; k++) {
    let peak = 0;
    for (let i = k * per; i < Math.min(buf.length, (k + 1) * per); i += 8) for (const c of ch) peak = Math.max(peak, Math.abs(c[i]));
    out.push(Math.round(peak * 1000) / 1000);
  }
  const max = Math.max(...out, 1e-6);
  return out.map((p) => p / max);
}

export function SongsTab({ engine, active, register, theme }: { engine: AudioEngine; active: boolean; register: Register; theme: string }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [current, setCurrent] = useState<Song | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(engine.song.loop);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(0.9);
  const [status, setStatus] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x0: number; t0: number; moved: boolean } | null>(null);

  useEffect(() => {
    listSongs().then(setSongs).catch(() => setStatus('No se pueden leer las canciones guardadas.'));
    engine.song.onEnded = () => setPlaying(false);
  }, [engine]);

  // Guarda bucle y velocidad con la canción (con un pequeño retardo)
  useEffect(() => {
    if (!current) return;
    const id = window.setTimeout(() => {
      const next = { ...current, loop, rate };
      saveSong(next).catch(() => undefined);
      setSongs((list) => list.map((s) => (s.id === next.id ? next : s)));
    }, 500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop, rate]);

  const open = (s: Song) => {
    engine.song.load(s.blob);
    const l = s.loop ?? { a: 0, b: 0, on: false };
    engine.song.loop = { ...l };
    engine.song.setRate(s.rate ?? 1);
    setLoop(l);
    setRate(s.rate ?? 1);
    setCurrent(s);
    setPlaying(false);
  };

  const importFile = async (file: File) => {
    if (!engine.ctx) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      setStatus(`El archivo pesa más de ${MAX_MB} MB. Usa un MP3 o M4A de la canción.`);
      return;
    }
    try {
      setStatus(`Preparando «${file.name}»…`);
      const buf = await engine.ctx.decodeAudioData(await file.arrayBuffer());
      setStatus('Calculando el tempo…');
      // Para el tempo bastan los primeros 90 segundos
      const mono = toMono(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).subarray(0, buf.sampleRate * 90)));
      const onsets = await analyzeOnsets(mono, buf.sampleRate, 0.4);
      const times = onsetSeconds(onsets, buf.sampleRate);
      const song: Song = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 80),
        createdAt: Date.now(),
        duration: buf.duration,
        blob: file,
        peaks: peaksOf(buf),
        bpm: times.length >= 8 ? estimateBpmFromTimes(times) : null
      };
      await saveSong(song);
      setSongs((l) => [song, ...l]);
      open(song);
      setStatus(null);
    } catch {
      setStatus('No se ha podido leer el archivo. Prueba con un MP3, M4A, WAV, OGG o FLAC.');
    }
  };

  const remove = async (s: Song) => {
    if (!window.confirm(`¿Borrar «${s.name}» de este navegador?`)) return;
    await deleteSong(s.id);
    setSongs((l) => l.filter((x) => x.id !== s.id));
    if (current?.id === s.id) {
      engine.song.unload();
      setCurrent(null);
      setPlaying(false);
    }
  };

  const togglePlay = async () => {
    if (!current) return;
    if (engine.song.playing) {
      engine.song.pause();
      setPlaying(false);
    } else {
      await engine.song.play();
      setPlaying(true);
    }
  };

  const applyLoop = (l: typeof loop) => {
    const fixed = l.b < l.a ? { ...l, a: l.b, b: l.a } : l;
    engine.song.loop = fixed;
    setLoop(fixed);
  };

  const toStart = () => engine.song.seek(loop.on ? loop.a : 0);

  useAction(register, 'song.play', () => {
    if (!current) return 'Elige una canción en la pestaña Canciones';
    const was = engine.song.playing;
    togglePlay();
    return was ? 'Canción en pausa' : `Reproduciendo «${current.name}»`;
  });
  useAction(register, 'song.toA', () => {
    toStart();
    return loop.on ? 'Inicio del bucle' : 'Inicio de la canción';
  });
  useAction(register, 'song.loop', () => {
    if (loop.b <= loop.a) return 'Marca primero A y B';
    applyLoop({ ...loop, on: !loop.on });
    return loop.on ? 'Bucle quitado' : 'Bucle activado';
  });

  // Onda con la zona del bucle
  useEffect(() => {
    const c = canvas.current;
    if (!c || !current || !active) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = (c.width = Math.round(c.clientWidth * dpr));
      const h = (c.height = Math.round(c.clientHeight * dpr));
      const g = c.getContext('2d')!;
      const css = getComputedStyle(c);
      g.clearRect(0, 0, w, h);
      if (loop.b > loop.a) {
        g.fillStyle = css.getPropertyValue(loop.on ? '--amber' : '--edge');
        g.globalAlpha = loop.on ? 0.22 : 0.35;
        g.fillRect((loop.a / current.duration) * w, 0, ((loop.b - loop.a) / current.duration) * w, h);
        g.globalAlpha = 1;
      }
      g.fillStyle = css.getPropertyValue('--muted');
      const p = current.peaks;
      for (let x = 0; x < w; x++) {
        const v = p[Math.floor((x / w) * p.length)] ?? 0;
        const y = Math.max(1, v * (h / 2 - 2));
        g.fillRect(x, h / 2 - y, 1, y * 2);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [current, loop, active, theme]);

  // Cabezal y tiempo
  useEffect(() => {
    if (!active || !current) return;
    let raf = 0;
    const tick = () => {
      const t = engine.song.time;
      if (head.current) head.current.style.left = `${Math.min(100, (t / current.duration) * 100)}%`;
      if (timeRef.current) timeRef.current.textContent = `${clockTenths(t)} / ${clock(current.duration)}`;
      if (engine.song.playing !== playing) setPlaying(engine.song.playing);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, current, engine, playing]);

  const timeAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (current?.duration ?? 0);
  };

  const bpm = current?.bpm ?? null;
  const setBpm = (v: number) => {
    if (!current) return;
    const next = { ...current, bpm: Math.round(v) };
    setCurrent(next);
    saveSong(next);
    setSongs((l) => l.map((s) => (s.id === next.id ? next : s)));
  };

  return (
    <div className="songs-layout">
      <section className="panel" aria-labelledby="songlist-title">
        <div className="panel-head">
          <h2 id="songlist-title">Canciones</h2>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Subir canción
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = '';
            }}
          />
        </div>
        {status && <p className="notice">{status}</p>}
        {songs.length === 0 ? (
          <p className="empty">
            Sube una canción para practicar encima con tu sonido: MP3, M4A, WAV, OGG o FLAC. Se guarda solo en este
            navegador.
          </p>
        ) : (
          <ul className="song-list">
            {songs.map((s) => (
              <li key={s.id} className={current?.id === s.id ? 'current' : undefined}>
                <button className="song-pick" onClick={() => open(s)}>
                  <strong>{s.name}</strong>
                  <span>
                    {clock(s.duration)}
                    {s.bpm ? ` · ${s.bpm} BPM` : ''}
                    {s.loop?.on ? ' · con bucle' : ''}
                  </span>
                </button>
                <button className="btn small ghost danger" onClick={() => remove(s)} aria-label={`Borrar ${s.name}`}>
                  Borrar
                </button>
              </li>
            ))}
          </ul>
        )}
        <details className="help">
          <summary>Cómo practicar con una canción</summary>
          <ol>
            <li>Sube la canción y pulsa Reproducir. Tu guitarra suena a la vez con tu pedalera.</li>
            <li>
              Para repetir un pasaje, <strong>arrastra sobre la onda</strong> de principio a fin: se crea el bucle A-B.
              También puedes marcar A y B mientras suena.
            </li>
            <li>
              Baja la <strong>velocidad</strong> para aprenderlo despacio: el tono no cambia. Súbela poco a poco hasta el
              100 %.
            </li>
            <li>
              Con <strong>Usar en el metrónomo</strong>, el metrónomo, la batería y el looper toman el tempo de la canción a
              la velocidad elegida.
            </li>
          </ol>
          <p>
            Usa archivos que tengas tú: comprados, descargados legalmente o grabaciones propias. Las canciones no salen de
            este navegador. Para grabarte tocando encima, usa Grabación en modo Mezcla: incluye la canción.
          </p>
        </details>
      </section>

      <section className="panel player" aria-labelledby="player-title">
        <div className="panel-head wrap">
          <h2 id="player-title">{current ? current.name : 'Reproductor'}</h2>
          {current && (
            <span className="studio-time" ref={timeRef}>
              0:00.0
            </span>
          )}
        </div>
        {!current ? (
          <p className="empty">Elige o sube una canción.</p>
        ) : (
          <>
            <div
              className="song-wave"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x0: e.clientX, t0: timeAt(e), moved: false };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                if (Math.abs(e.clientX - d.x0) > 6) d.moved = true;
                if (d.moved) applyLoop({ a: d.t0, b: timeAt(e), on: true });
              }}
              onPointerUp={(e) => {
                const d = drag.current;
                drag.current = null;
                if (!d) return;
                if (d.moved) engine.song.seek(Math.min(d.t0, timeAt(e)));
                else engine.song.seek(timeAt(e));
              }}
              title="Haz clic para ir a un punto; arrastra para crear un bucle"
            >
              <canvas ref={canvas} />
              <div className="playhead" ref={head} />
            </div>

            <div className="player-transport">
              <button className="btn" onClick={toStart} aria-label={loop.on ? 'Volver al inicio del bucle' : 'Volver al inicio'}>
                ⏮
              </button>
              <button className={`btn${playing ? ' primary-soft' : ''} play-btn`} onClick={togglePlay}>
                {playing ? 'Pausa' : 'Reproducir'}
              </button>
              <span className="loop-controls">
                <button className="btn small" onClick={() => applyLoop({ ...loop, a: engine.song.time, b: Math.max(loop.b, engine.song.time) })}>
                  Marcar A
                </button>
                <button className="btn small" onClick={() => applyLoop({ ...loop, b: engine.song.time, on: engine.song.time > loop.a })}>
                  Marcar B
                </button>
                <button
                  className={`toggle${loop.on ? ' on' : ''}`}
                  aria-pressed={loop.on}
                  disabled={loop.b <= loop.a}
                  onClick={() => applyLoop({ ...loop, on: !loop.on })}
                >
                  Bucle
                </button>
                {loop.b > loop.a && (
                  <>
                    <span className="hint">
                      {clockTenths(loop.a)} – {clockTenths(loop.b)}
                    </span>
                    <button className="btn small ghost" onClick={() => applyLoop({ a: 0, b: 0, on: false })}>
                      Quitar
                    </button>
                  </>
                )}
              </span>
            </div>

            <div className="player-settings">
              <div className="field">
                <span>
                  Velocidad <output>{Math.round(rate * 100)} %</output>
                </span>
                <input
                  type="range"
                  min={0.4}
                  max={1.25}
                  step={0.05}
                  value={rate}
                  onChange={(e) => {
                    const r = Number(e.target.value);
                    engine.song.setRate(r);
                    setRate(r);
                  }}
                />
                <span className="rate-presets">
                  {[0.5, 0.75, 0.9, 1].map((r) => (
                    <button
                      key={r}
                      className={`toggle${rate === r ? ' on' : ''}`}
                      onClick={() => {
                        engine.song.setRate(r);
                        setRate(r);
                      }}
                    >
                      {r * 100} %
                    </button>
                  ))}
                </span>
              </div>
              <div className="field">
                <span>
                  Tempo{' '}
                  <output>
                    {bpm ? `${bpm} BPM original${rate !== 1 ? ` · ${Math.round(bpm * rate)} a esta velocidad` : ''}` : 'sin detectar'}
                  </output>
                </span>
                <span className="tempo-tools">
                  <input
                    type="number"
                    min={30}
                    max={300}
                    value={bpm ?? ''}
                    placeholder="BPM"
                    onChange={(e) => Number(e.target.value) >= 30 && setBpm(Number(e.target.value))}
                    aria-label="Tempo original"
                  />
                  <button className="btn small" disabled={!bpm} onClick={() => bpm && setBpm(bpm / 2)} title="Si sale el doble del real">
                    ÷2
                  </button>
                  <button className="btn small" disabled={!bpm} onClick={() => bpm && setBpm(bpm * 2)} title="Si sale la mitad del real">
                    ×2
                  </button>
                  <button
                    className="btn small"
                    disabled={!bpm}
                    onClick={() => bpm && window.dispatchEvent(new CustomEvent('guitart:set-bpm', { detail: Math.round(bpm * rate) }))}
                  >
                    Usar en el metrónomo
                  </button>
                </span>
                <small className="hint">El tempo es una estimación: si sale el doble o la mitad, corrígelo con ÷2 o ×2.</small>
              </div>
              <label className="field">
                <span>
                  Volumen de la canción <output>{Math.round(volume * 100)} %</output>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1.2}
                  step={0.01}
                  value={volume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    engine.song.setVolume(v);
                    setVolume(v);
                  }}
                />
              </label>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
