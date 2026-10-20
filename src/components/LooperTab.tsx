import { useCallback, useEffect, useRef, useState } from 'react';
import { PATTERNS, resizeSteps, VOICES, type DrumVoice } from '../audio/drums';
import type { AudioEngine } from '../audio/engine';
import type { LooperState, LooperStatus } from '../audio/looper';
import type { RhythmSettings } from '../audio/transport';
import { useAction, type Register } from '../control/registry';

interface RhythmPrefs extends RhythmSettings {
  patternId: string; // 'custom' si se ha editado
  countIn: number;
  sync: boolean;
  looperVolume: number;
  helpSeen: boolean;
}

const KEY = 'guitart:rhythm';
const DEFAULTS: RhythmPrefs = {
  bpm: 100,
  beatsPerBar: 4,
  metronome: true,
  metronomeVolume: 0.6,
  drums: false,
  drumVolume: 0.7,
  swing: 0,
  steps: PATTERNS[0].steps,
  patternId: 'rock',
  countIn: 1,
  sync: true,
  looperVolume: 1,
  helpSeen: false
};

function usePrefs() {
  const [prefs, setPrefs] = useState<RhythmPrefs>(() => {
    try {
      const p = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } as RhythmPrefs;
      return { ...p, steps: resizeSteps(p.steps, p.beatsPerBar) };
    } catch {
      return DEFAULTS;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* sin almacenamiento */
    }
  }, [prefs]);
  const update = useCallback((patch: Partial<RhythmPrefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  return [prefs, update] as const;
}

const fmt = (frames: number, sr: number) => {
  const s = frames / sr;
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

const COPY: Record<LooperState, { title: string; hint: string; main: string }> = {
  empty: { title: 'Vacío', hint: 'Pulsa Grabar y toca la primera frase.', main: 'Grabar' },
  armed: {
    title: 'Preparado',
    hint: 'La grabación empezará al inicio del próximo compás, después de la cuenta atrás.',
    main: 'Cancelar'
  },
  recording: {
    title: 'Grabando la primera vuelta',
    hint: 'Cuando termines la frase, pulsa Cerrar vuelta: empezará a repetirse sola.',
    main: 'Cerrar vuelta'
  },
  playing: {
    title: 'Reproduciendo',
    hint: 'Pulsa Añadir capa para tocar encima: lo que toques se sumará al bucle.',
    main: 'Añadir capa'
  },
  overdub: {
    title: 'Añadiendo capa',
    hint: 'Todo lo que toques se suma al bucle. Pulsa Dejar de añadir para terminar la capa.',
    main: 'Dejar de añadir'
  },
  stopped: {
    title: 'Parado',
    hint: 'El bucle se conserva. Pulsa Reproducir para oírlo, o Añadir capa para tocar encima desde el principio.',
    main: 'Añadir capa'
  }
};

interface LooperTabProps {
  engine: AudioEngine;
  active: boolean;
  latencyMs: number;
  register: Register;
}

export function LooperTab({ engine, active, latencyMs, register }: LooperTabProps) {
  const [prefs, update] = usePrefs();
  const [playing, setPlaying] = useState(engine.transport.playing);
  const [status, setStatus] = useState<LooperStatus>(engine.looper.status);
  const statusRef = useRef(status);
  const lamps = useRef<HTMLSpanElement[]>([]);
  const cols = useRef<HTMLElement[][]>([]);
  const progress = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const taps = useRef<number[]>([]);

  // Ajustes de ritmo y looper hacia el motor
  useEffect(() => {
    const { bpm, beatsPerBar, metronome, metronomeVolume, drums, drumVolume, swing, steps } = prefs;
    engine.transport.update({ bpm, beatsPerBar, metronome, metronomeVolume, drums, drumVolume, swing, steps });
    engine.looper.setVolume(prefs.looperVolume);
  }, [engine, prefs]);

  useEffect(() => engine.looper.setLatency(latencyMs), [engine, latencyMs]);

  useEffect(
    () =>
      engine.looper.subscribe((s) => {
        const prev = statusRef.current;
        statusRef.current = s;
        if (
          s.state !== prev.state ||
          s.layers !== prev.layers ||
          s.canUndo !== prev.canUndo ||
          s.pending !== prev.pending ||
          s.len !== prev.len
        )
          setStatus(s);
      }),
    [engine]
  );

  // Animación: pulsos, paso actual de la batería y progreso del bucle (solo con la pestaña visible)
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      const pos = engine.transport.position();
      lamps.current.forEach((el, i) => {
        if (!el) return;
        el.dataset.on = pos && pos.beat === i ? (pos.countIn ? 'count' : i === 0 ? 'accent' : 'on') : 'off';
      });
      cols.current.forEach((col, i) => col?.forEach((el) => el && (el.dataset.now = pos && pos.step === i ? '1' : '0')));
      const s = statusRef.current;
      if (progress.current) {
        const frac = s.state === 'recording' ? 1 : s.len ? s.pos / s.len : 0;
        progress.current.style.setProperty('--p', String(frac));
      }
      if (timeRef.current) {
        timeRef.current.textContent =
          s.state === 'recording' ? fmt(s.recorded, s.sampleRate) : s.len ? `${fmt(s.pos, s.sampleRate)} / ${fmt(s.len, s.sampleRate)}` : '0:00.0';
      }
      if (engine.transport.playing !== playing) setPlaying(engine.transport.playing);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, engine, playing]);

  const startTransport = () => {
    const ctx = engine.ctx;
    if (!ctx) return null;
    const start = ctx.currentTime + 0.1;
    engine.transport.start(start, prefs.countIn);
    setPlaying(true);
    return start + prefs.countIn * engine.transport.barDur;
  };

  const toggleTransport = () => {
    if (engine.transport.playing) {
      engine.transport.stop();
      setPlaying(false);
    } else startTransport();
  };

  const pressMain = () => {
    const s = statusRef.current;
    const t = engine.transport;
    if (s.state === 'armed') return engine.looper.send('clear');
    if (s.state === 'empty') {
      if (!prefs.sync) return engine.looper.send('rec');
      const at = t.playing ? t.nextBarTime() : startTransport();
      return engine.looper.send('rec', at ?? undefined);
    }
    if (s.state === 'recording' && prefs.sync && t.playing) {
      return engine.looper.send('rec', t.nextBarTime((engine.ctx?.currentTime ?? 0) + 0.01) ?? undefined);
    }
    engine.looper.send('rec');
  };

  const tap = () => {
    const now = performance.now();
    const list = taps.current.filter((t) => now - t < 2500);
    list.push(now);
    taps.current = list.slice(-5);
    if (taps.current.length >= 3) {
      const gaps = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      update({ bpm: Math.max(40, Math.min(240, Math.round(60000 / avg))) });
    }
  };

  useAction(register, 'looper.main', () => {
    const s = statusRef.current;
    const label = s.state === 'recording' && s.pending === 'rec' ? '' : COPY[s.state].main;
    pressMain();
    return label ? `Looper: ${label}` : undefined;
  });
  useAction(register, 'looper.stop', () => {
    const stopped = statusRef.current.state === 'stopped';
    engine.looper.send(stopped ? 'play' : 'stop');
    return stopped ? 'Looper: reproducir' : 'Looper: parar';
  });
  useAction(register, 'looper.undo', () => {
    engine.looper.send('undo');
    return 'Looper: deshacer capa';
  });
  useAction(register, 'rhythm.toggle', () => {
    const was = engine.transport.playing;
    toggleTransport();
    return was ? 'Ritmo parado' : 'Ritmo en marcha';
  });
  useAction(register, 'rhythm.tap', () => {
    tap();
    return 'Marcando el tempo';
  });

  const setMeter = (beatsPerBar: number) =>
    update({ beatsPerBar, steps: resizeSteps(prefs.steps, beatsPerBar), patternId: 'custom' });

  const loadPattern = (id: string) => {
    const p = PATTERNS.find((x) => x.id === id);
    if (!p) return;
    update({ patternId: id, beatsPerBar: p.beatsPerBar, swing: p.swing, steps: p.steps, drums: true });
  };

  const toggleStep = (voice: DrumVoice, i: number) => {
    const row = [...prefs.steps[voice]];
    row[i] = row[i] === 0 ? 1 : row[i] === 1 ? 0.5 : 0; // vacío → fuerte → suave → vacío
    update({ steps: { ...prefs.steps, [voice]: row }, patternId: 'custom' });
  };

  const st = status.state;
  const closing = st === 'recording' && status.pending === 'rec';
  const copy = COPY[st];
  const steps = prefs.beatsPerBar * 4;
  cols.current = [];

  return (
    <div className="looper-layout">
      <section className="panel looper" data-state={st} aria-labelledby="looper-title">
        <div className="panel-head">
          <h2 id="looper-title">Looper</h2>
          <span className="hint">Atajos y pedales: pestaña Ajustes</span>
        </div>

        <div className="looper-status" aria-live="polite">
          <span className="looper-lamp" aria-hidden="true" />
          <div>
            <strong>{closing ? 'Cerrando la vuelta' : copy.title}</strong>
            <p>{closing ? 'Se cerrará al final de este compás y empezará a repetirse.' : copy.hint}</p>
          </div>
        </div>

        <div className="looper-progress" ref={progress}>
          <div className="looper-bar" />
        </div>
        <div className="looper-meta">
          <span ref={timeRef}>0:00.0</span>
          <span>{status.layers > 0 ? `${status.layers} ${status.layers === 1 ? 'capa' : 'capas'}` : 'Sin capas'}</span>
        </div>

        <button className="looper-main" onClick={pressMain}>
          {closing ? 'Cerrando…' : copy.main}
        </button>

        <div className="looper-actions">
          {st === 'stopped' ? (
            <button className="btn" onClick={() => engine.looper.send('play')}>
              Reproducir
            </button>
          ) : (
            <button className="btn" onClick={() => engine.looper.send('stop')} disabled={st === 'empty'}>
              Parar
            </button>
          )}
          <button className="btn" onClick={() => engine.looper.send('undo')} disabled={!status.canUndo}>
            Deshacer capa
          </button>
          <button
            className="btn ghost danger"
            disabled={st === 'empty'}
            onClick={() => (status.len === 0 || window.confirm('¿Borrar el bucle completo?')) && engine.looper.send('clear')}
          >
            Borrar
          </button>
        </div>

        <label className="check">
          <input type="checkbox" checked={prefs.sync} onChange={(e) => update({ sync: e.target.checked })} />
          <span>
            Sincronizar con el compás
            <small>La grabación empieza al inicio de un compás y la vuelta se cierra al final del compás en curso.</small>
          </span>
        </label>
        <label className="field">
          <span>
            Volumen del bucle <output>{Math.round(prefs.looperVolume * 100)} %</output>
          </span>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={prefs.looperVolume}
            onChange={(e) => update({ looperVolume: Number(e.target.value) })}
          />
        </label>

        <details className="help guide" open={!prefs.helpSeen} onToggle={(e) => !e.currentTarget.open && update({ helpSeen: true })}>
          <summary>Cómo funciona el looper</summary>
          <ol>
            <li>
              <strong>Grabar.</strong> Pulsa el botón y toca una frase: por ejemplo, unos acordes.
            </li>
            <li>
              <strong>Cerrar la vuelta.</strong> Pulsa otra vez al terminar. Lo que has grabado se repite sin parar, y su
              duración marca la duración del bucle.
            </li>
            <li>
              <strong>Añadir capas.</strong> Mientras suena, pulsa para tocar encima (un punteo, una segunda voz). Pulsa de
              nuevo para dejar de añadir. Puedes añadir tantas capas como quieras.
            </li>
            <li>
              <strong>Deshacer capa</strong> quita la última capa añadida. <strong>Parar</strong> detiene el bucle sin
              borrarlo y <strong>Borrar</strong> lo elimina para empezar de cero.
            </li>
          </ol>
          <p>
            Con <strong>Sincronizar con el compás</strong> activado, la grabación arranca con la cuenta atrás del metrónomo
            y la vuelta se ajusta a compases enteros, así el bucle siempre cuadra con el tempo y con la batería. Desactívalo
            para un looper libre que graba en el momento exacto en que pulsas.
          </p>
          <p>
            El looper graba tu guitarra con los efectos de la pedalera; ni el bucle ni la batería se vuelven a grabar
            encima. Para que las capas encajen bien, mide la latencia en la pestaña Afinador y audio: el looper la compensa
            automáticamente.
          </p>
        </details>
      </section>

      <div className="stack">
        <section className="panel tempo" aria-labelledby="tempo-title">
          <div className="panel-head">
            <h2 id="tempo-title">Tempo</h2>
            <button className={`btn${playing ? ' primary-soft' : ''}`} onClick={toggleTransport}>
              {playing ? 'Parar ritmo' : 'Iniciar ritmo'}
            </button>
          </div>
          <div className="bpm">
            <button className="btn" onClick={() => update({ bpm: Math.max(40, prefs.bpm - 1) })} aria-label="Bajar tempo">
              −
            </button>
            <output className="bpm-value">
              {prefs.bpm}
              <small>BPM</small>
            </output>
            <button className="btn" onClick={() => update({ bpm: Math.min(240, prefs.bpm + 1) })} aria-label="Subir tempo">
              +
            </button>
            <button className="btn" onClick={tap} title="Pulsa al ritmo varias veces">
              Marcar
            </button>
          </div>
          <input
            type="range"
            min={40}
            max={240}
            value={prefs.bpm}
            onChange={(e) => update({ bpm: Number(e.target.value) })}
            aria-label="Tempo en pulsaciones por minuto"
          />
          <div className="beats" aria-hidden="true">
            {Array.from({ length: prefs.beatsPerBar }, (_, i) => (
              <span key={i} ref={(el) => el && (lamps.current[i] = el)} data-on="off" />
            ))}
          </div>
          <div className="tempo-row">
            <label className="field">
              <span>Compás</span>
              <select value={prefs.beatsPerBar} onChange={(e) => setMeter(Number(e.target.value))}>
                {[2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n}/4
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Cuenta atrás</span>
              <select value={prefs.countIn} onChange={(e) => update({ countIn: Number(e.target.value) })}>
                <option value={0}>Sin cuenta</option>
                <option value={1}>1 compás</option>
                <option value={2}>2 compases</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={prefs.metronome} onChange={(e) => update({ metronome: e.target.checked })} />
            <span>Metrónomo</span>
          </label>
          <label className="field">
            <span>
              Volumen del metrónomo <output>{Math.round(prefs.metronomeVolume * 100)} %</output>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={prefs.metronomeVolume}
              onChange={(e) => update({ metronomeVolume: Number(e.target.value) })}
            />
          </label>
        </section>

        <section className="panel drums" aria-labelledby="drums-title">
          <div className="panel-head">
            <h2 id="drums-title">Caja de ritmos</h2>
            <button
              className={`switch${prefs.drums ? ' on' : ''}`}
              role="switch"
              aria-checked={prefs.drums}
              onClick={() => update({ drums: !prefs.drums })}
            >
              <span className="lamp" aria-hidden="true" />
              {prefs.drums ? 'Activada' : 'Apagada'}
            </button>
          </div>
          <label className="field">
            <span>Ritmo</span>
            <select value={prefs.patternId} onChange={(e) => loadPattern(e.target.value)}>
              {prefs.patternId === 'custom' && <option value="custom">Personalizado</option>}
              {PATTERNS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid-scroll">
            <table className="drum-grid" style={{ ['--steps' as string]: steps }}>
              <tbody>
                {VOICES.map((v) => (
                  <tr key={v.id}>
                    <th scope="row">{v.name}</th>
                    {prefs.steps[v.id].map((val, i) => (
                      <td key={i} className={i % 4 === 0 ? 'beat-start' : undefined}>
                        <button
                          ref={(el) => {
                            if (!el) return;
                            (cols.current[i] ??= []).push(el);
                          }}
                          data-v={val === 1 ? 'full' : val > 0 ? 'soft' : 'off'}
                          aria-label={`${v.name}, pulso ${Math.floor(i / 4) + 1}, semicorchea ${(i % 4) + 1}: ${val === 1 ? 'fuerte' : val > 0 ? 'suave' : 'vacía'}`}
                          onClick={() => toggleStep(v.id, i)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Toca una casilla para alternar: fuerte, suave, vacía.</p>
          <label className="field">
            <span>
              Swing <output>{Math.round(prefs.swing * 100)} %</output>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={prefs.swing}
              onChange={(e) => update({ swing: Number(e.target.value), patternId: 'custom' })}
            />
          </label>
          <label className="field">
            <span>
              Volumen <output>{Math.round(prefs.drumVolume * 100)} %</output>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={prefs.drumVolume}
              onChange={(e) => update({ drumVolume: Number(e.target.value) })}
            />
          </label>
        </section>
      </div>
    </div>
  );
}
