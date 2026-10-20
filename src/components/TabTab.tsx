import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { midiName, TUNINGS } from '../audio/pitch';
import { listRecordings, type Recording } from '../storage/recordings';
import { noteLabel, toAscii } from '../tab/ascii';
import { chordShape, detectChords } from '../tab/chords';
import { MAX_FRET, quantize, type TabNote } from '../tab/fingering';
import { transcribePoly } from '../tab/poly';
import { playNote } from '../tab/synth';
import { DEFAULT_TRANSCRIBE, estimateBpm, toMono, transcribe, type Legato, type RawNote, type Technique } from '../tab/transcribe';

export interface TabRequest {
  n: number;
  title: string;
  channels: Float32Array[];
  sampleRate: number;
  dry: boolean;
}

interface TabDoc {
  title: string;
  bpm: number;
  detectedBpm: number;
  beatsPerBar: number;
  tuningId: string;
  /** 'first': la primera nota cae en el tiempo 1 · 'start': la grabación empieza en el tiempo 1 */
  offsetMode: 'first' | 'start';
  sensitivity: number;
  /** mono: notas sueltas (rápido) · poly: acordes y notas con el modelo de IA */
  mode?: 'mono' | 'poly';
  showChords?: boolean;
  raw: RawNote[];
  notes: TabNote[];
  edited: boolean;
}

const KEY = 'guitart:tab';
const STEP_W = 22;
const LINE_H = 16;
const PAD = 10;
const TOP = 30;

function loadDoc(): TabDoc | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

interface Props {
  engine: AudioEngine;
  active: boolean;
  request: TabRequest | null;
  defaultTuning: string;
  a4: number;
}

export function TabTab({ engine, active, request, defaultTuning, a4 }: Props) {
  const [doc, setDoc] = useState<TabDoc | null>(loadDoc);
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [playing, setPlaying] = useState<'original' | 'tab' | null>(null);
  const [takes, setTakes] = useState<Recording[] | null>(null);
  const [warnWet, setWarnWet] = useState(false);
  const audio = useRef<{ mono: Float32Array; buffer: AudioBuffer | null; sr: number } | null>(null);
  const cursors = useRef(new Map<number, SVGLineElement>());
  const play = useRef<{ startCtx: number; startStep: number; sd: number; srcs: AudioBufferSourceNode[] } | null>(null);
  const typed = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (doc) localStorage.setItem(KEY, JSON.stringify(doc));
    } catch {
      /* sin almacenamiento */
    }
  }, [doc]);

  const tuning = TUNINGS.find((t) => t.id === doc?.tuningId) ?? TUNINGS[0];
  const perBar = (doc?.beatsPerBar ?? 4) * 4;
  const sd = 60 / (doc?.bpm ?? 100) / 4;

  const requantize = (d: TabDoc): TabDoc => {
    const t = TUNINGS.find((x) => x.id === d.tuningId) ?? TUNINGS[0];
    const offset = d.offsetMode === 'first' && d.raw.length ? d.raw[0].t : 0;
    return { ...d, notes: quantize(d.raw, d.bpm, offset, t.midi, d.mode === 'poly'), edited: false };
  };

  const analyze = async (title: string, channels: Float32Array[], sr: number, dry: boolean, base?: Partial<TabDoc>) => {
    stop();
    setSelected(null);
    setWarnWet(!dry);
    setStatus('Analizando la grabación… 0 %');
    const mono = toMono(channels);
    const ctx = engine.ctx;
    let buffer: AudioBuffer | null = null;
    if (ctx) {
      buffer = ctx.createBuffer(channels.length, channels[0].length, sr);
      channels.forEach((c, i) => buffer!.copyToChannel(new Float32Array(c), i));
    }
    audio.current = { mono, buffer, sr };
    const sensitivity = base?.sensitivity ?? doc?.sensitivity ?? 0.5;
    const mode = base?.mode ?? doc?.mode ?? 'mono';
    let raw: RawNote[];
    try {
      raw =
        mode === 'poly'
          ? await transcribePoly(mono, sr, sensitivity, (p) =>
              setStatus(
                p === 0
                  ? 'Cargando el modelo de IA (solo la primera vez tarda más)…'
                  : `Analizando acordes y notas… ${Math.round(p * 100)} %`
              )
            )
          : await transcribe(mono, sr, { ...DEFAULT_TRANSCRIBE, sensitivity, a4 }, (p) =>
              setStatus(`Analizando la grabación… ${Math.round(p * 100)} %`)
            );
    } catch {
      setStatus('No se ha podido cargar el modelo de IA. Comprueba la conexión (la primera vez se descarga) y vuelve a probar.');
      return;
    }
    const detectedBpm = estimateBpm(raw);
    const next = requantize({
      title,
      bpm: base?.bpm ?? detectedBpm,
      detectedBpm,
      beatsPerBar: base?.beatsPerBar ?? doc?.beatsPerBar ?? 4,
      tuningId: base?.tuningId ?? doc?.tuningId ?? defaultTuning,
      offsetMode: base?.offsetMode ?? 'first',
      sensitivity,
      mode,
      showChords: base?.showChords ?? mode === 'poly',
      raw,
      notes: [],
      edited: false
    });
    setDoc(next);
    setStatus(raw.length ? null : 'No se han encontrado notas. Prueba con más sensibilidad o con una toma en seco.');
  };

  // Petición desde Grabación o Estudio
  const lastReq = useRef(0);
  useEffect(() => {
    if (!request || request.n === lastReq.current) return;
    lastReq.current = request.n;
    analyze(request.title, request.channels, request.sampleRate, request.dry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const analyzeTake = async (id: string) => {
    const take = takes?.find((t) => t.id === id);
    if (!take || !engine.ctx) return;
    const buf = await engine.ctx.decodeAudioData(await take.blob.arrayBuffer());
    const ch = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
    analyze(take.name, ch, buf.sampleRate, take.source === 'dry' || !take.source);
  };

  const change = (patch: Partial<TabDoc>) => {
    if (!doc) return;
    if (doc.edited && !window.confirm('Recalcular la tablatura desde el audio descarta tus correcciones. ¿Continuar?')) return;
    setDoc(requantize({ ...doc, ...patch }));
    setSelected(null);
  };

  const editNotes = (fn: (notes: TabNote[]) => TabNote[]) =>
    setDoc((d) => (d ? { ...d, notes: fn(d.notes).sort((a, b) => a.step - b.step || a.string - b.string), edited: true } : d));

  const sel = doc?.notes.find((n) => n.id === selected) ?? null;

  const prevOnString = (n: TabNote) =>
    doc?.notes.filter((m) => m.string === n.string && m.step < n.step).pop()?.midi;

  const preview = (midi: number, n?: TabNote) => {
    const ctx = engine.ctx;
    if (ctx) playNote(ctx, ctx.destination, midi, ctx.currentTime + 0.01, 0.6, n?.tech, n ? prevOnString(n) : undefined);
  };

  const setTech = (patch: Partial<Technique>) => {
    if (!sel) return;
    const tech: Technique = { ...sel.tech, ...patch };
    (Object.keys(tech) as (keyof Technique)[]).forEach((k) => tech[k] === undefined && delete tech[k]);
    const next = { ...sel, tech: Object.keys(tech).length ? tech : undefined };
    editNotes((ns) => ns.map((n) => (n.id === sel.id ? next : n)));
    preview(next.midi, next);
  };

  const updateSel = (patch: Partial<TabNote>, listen = false) => {
    if (!sel) return;
    const next = { ...sel, ...patch };
    if (next.fret < 0 || next.fret > MAX_FRET || next.dur < 1 || next.step < 0) return;
    const clash = doc!.notes.some((n) => n.id !== sel.id && n.string === next.string && n.step === next.step);
    if (clash) return;
    next.midi = tuning.midi[next.string] + next.fret;
    editNotes((ns) => ns.map((n) => (n.id === sel.id ? next : n)));
    if (listen) preview(next.midi);
  };

  /** Misma nota en otra cuerda (más aguda: +1, más grave: -1). */
  const moveString = (dir: 1 | -1) => {
    if (!sel) return;
    for (let s = sel.string + dir; s >= 0 && s < tuning.midi.length; s += dir) {
      const fret = sel.midi - tuning.midi[s];
      if (fret >= 0 && fret <= MAX_FRET) return updateSel({ string: s, fret });
    }
  };

  const remove = () => {
    if (!sel || !doc) return;
    const i = doc.notes.findIndex((n) => n.id === sel.id);
    editNotes((ns) => ns.filter((n) => n.id !== sel.id));
    setSelected(doc.notes[i + 1]?.id ?? doc.notes[i - 1]?.id ?? null);
  };

  const add = (step: number, string: number) => {
    const n: TabNote = { id: crypto.randomUUID(), step, dur: 2, string, fret: 0, midi: tuning.midi[string] };
    editNotes((ns) => [...ns, n]);
    setSelected(n.id);
    preview(n.midi);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!doc) return;
    const i = sel ? doc.notes.findIndex((n) => n.id === sel.id) : -1;
    const handled = () => e.preventDefault();
    if (/^[0-9]$/.test(e.key) && sel) {
      // Trastes de dos cifras: se escriben seguidos (1 y 2 → 12)
      const now = performance.now();
      const text = now - typed.current.at < 700 ? typed.current.text + e.key : e.key;
      typed.current = { text, at: now };
      const fret = Number(text) <= MAX_FRET ? Number(text) : Number(e.key);
      updateSel({ fret }, true);
      return handled();
    }
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowLeft': {
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey && sel) updateSel({ step: sel.step + dir });
        else setSelected(doc.notes[Math.max(0, Math.min(doc.notes.length - 1, i + dir))]?.id ?? null);
        return handled();
      }
      case 'ArrowUp':
        moveString(1);
        return handled();
      case 'ArrowDown':
        moveString(-1);
        return handled();
      case '+':
      case '=':
      case ']':
        if (sel) updateSel({ dur: sel.dur + 1 });
        return handled();
      case '-':
      case '[':
        if (sel) updateSel({ dur: sel.dur - 1 });
        return handled();
      case 'Delete':
      case 'Backspace':
        remove();
        return handled();
      case 'Escape':
        setSelected(null);
        return handled();
    }
  };

  // ── Reproducción ──
  function stop() {
    play.current?.srcs.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* ya parado */
      }
    });
    play.current = null;
    setPlaying(null);
  }

  const startPlay = (mode: 'original' | 'tab') => {
    const ctx = engine.ctx;
    if (!ctx || !doc) return;
    stop();
    const startStep = sel ? sel.step : 0;
    const at = ctx.currentTime + 0.08;
    const srcs: AudioBufferSourceNode[] = [];
    if (mode === 'original' && audio.current?.buffer) {
      const offset = doc.offsetMode === 'first' && doc.raw.length ? doc.raw[0].t : 0;
      const src = new AudioBufferSourceNode(ctx, { buffer: audio.current.buffer });
      src.connect(ctx.destination);
      src.start(at, Math.max(0, offset + startStep * sd));
      srcs.push(src);
    } else {
      for (const n of doc.notes)
        if (n.step >= startStep)
          srcs.push(playNote(ctx, ctx.destination, n.midi, at + (n.step - startStep) * sd, n.dur * sd, n.tech, prevOnString(n)));
    }
    play.current = { startCtx: at, startStep, sd, srcs };
    setPlaying(mode);
  };

  const lastStep = doc ? doc.notes.reduce((m, n) => Math.max(m, n.step + n.dur), 0) : 0;
  const bars = Math.max(1, Math.ceil(lastStep / perBar)) + 1;

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      const p = play.current;
      const ctx = engine.ctx;
      const step = p && ctx ? p.startStep + (ctx.currentTime - (ctx.outputLatency || 0) - p.startCtx) / p.sd : -1;
      cursors.current.forEach((line, b) => {
        const local = step - b * perBar;
        const on = step >= 0 && local >= 0 && local < perBar;
        line.style.display = on ? '' : 'none';
        if (on) {
          const x = PAD + local * STEP_W;
          line.setAttribute('x1', String(x));
          line.setAttribute('x2', String(x));
        }
      });
      if (p && step > Math.max(lastStep, 1) + 4) stop();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  const chords = useMemo(
    () => (doc?.showChords ? detectChords(doc.notes, doc.beatsPerBar, tuning.flats) : []),
    [doc, tuning]
  );
  const uniqueChords = useMemo(() => {
    const seen = new Map<string, (typeof chords)[number]>();
    chords.forEach((c) => seen.set(c.name, c));
    return [...seen.values()];
  }, [chords]);

  const ascii = useMemo(
    () =>
      doc
        ? toAscii(doc.notes, {
            tuning: tuning.midi,
            flats: tuning.flats,
            beatsPerBar: doc.beatsPerBar,
            bpm: doc.bpm,
            title: doc.title,
            tuningName: tuning.name,
            chords
          })
        : '',
    [doc, tuning, chords]
  );

  const clickBar = (e: React.MouseEvent<SVGSVGElement>, bar: number) => {
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const local = Math.floor((p.x - PAD) / STEP_W);
    const row = Math.round((p.y - TOP) / LINE_H);
    if (local < 0 || local >= perBar || row < 0 || row > 5) return;
    const string = 5 - row;
    const step = bar * perBar + local;
    const hit = doc?.notes.find((n) => n.string === string && n.step === step);
    if (hit) {
      setSelected(hit.id);
      preview(hit.midi);
    } else add(step, string);
    boardRef.current?.focus();
  };

  const names = tuning.midi.map((m) => midiName(m, tuning.flats).letter);

  return (
    <div className="tab-layout">
      <section className="panel" aria-labelledby="tabsrc-title">
        <div className="panel-head wrap">
          <h2 id="tabsrc-title">Tablatura</h2>
          <select
            className="tab-take"
            value=""
            onFocus={() => listRecordings().then(setTakes)}
            onChange={(e) => analyzeTake(e.target.value)}
            aria-label="Analizar una toma"
          >
            <option value="">Analizar una toma…</option>
            {takes?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.source === 'dry' || !t.source ? ' (en seco)' : ''}
              </option>
            ))}
          </select>
        </div>

        {status && <p className="notice">{status}</p>}
        {warnWet && doc && (
          <p className="notice">
            Esta toma tiene efectos. La distorsión y los efectos añaden armónicos que confunden la detección: con una toma en
            seco el resultado será más fiable.
          </p>
        )}

        {!doc ? (
          <div className="tab-empty">
            <p>
              Convierte una toma en tablatura: elige una arriba, o pulsa <strong>Pasar a TAB</strong> en una toma de
              Grabación o en una pista del Estudio.
            </p>
            <p className="hint">
              Funciona con notas sueltas (riffs, melodías, solos). Para mejores resultados, graba en seco y con metrónomo.
            </p>
          </div>
        ) : (
          <>
            <div className="tab-settings">
              <label className="field">
                <span>Título</span>
                <input value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} />
              </label>
              <label className="field">
                <span>
                  Tempo <output>detectado: {doc.detectedBpm}</output>
                </span>
                <span className="tab-bpm">
                  <input
                    type="number"
                    min={40}
                    max={240}
                    value={doc.bpm}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v >= 40 && v <= 240) change({ bpm: v });
                    }}
                  />
                  <button className="btn small" onClick={() => change({ bpm: engine.transport.s.bpm })} title="Usar el tempo de la pestaña Looper y ritmo">
                    Metrónomo ({engine.transport.s.bpm})
                  </button>
                </span>
              </label>
              <label className="field">
                <span>Compás</span>
                <select value={doc.beatsPerBar} onChange={(e) => change({ beatsPerBar: Number(e.target.value) })}>
                  {[2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n}/4
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Afinación</span>
                <select value={doc.tuningId} onChange={(e) => change({ tuningId: e.target.value })}>
                  {TUNINGS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Detección</span>
                <select
                  value={doc.mode ?? 'mono'}
                  onChange={(e) => {
                    const mode = e.target.value as 'mono' | 'poly';
                    if (!audio.current) return setDoc({ ...doc, mode });
                    if (doc.edited && !window.confirm('Volver a analizar descarta tus correcciones. ¿Continuar?')) return;
                    analyze(doc.title, [audio.current.mono], audio.current.sr, !warnWet, { ...doc, mode, showChords: mode === 'poly' || doc.showChords });
                  }}
                >
                  <option value="mono">Notas sueltas (rápido)</option>
                  <option value="poly">Acordes y notas (IA)</option>
                </select>
              </label>
              <label className="field">
                <span>Inicio del compás 1</span>
                <select value={doc.offsetMode} onChange={(e) => change({ offsetMode: e.target.value as TabDoc['offsetMode'] })}>
                  <option value="first">En la primera nota</option>
                  <option value="start">Al empezar la grabación</option>
                </select>
              </label>
              <label className="field">
                <span>
                  Sensibilidad <output>{Math.round(doc.sensitivity * 100)} %</output>
                </span>
                <span className="tab-bpm">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={doc.sensitivity}
                    onChange={(e) => setDoc({ ...doc, sensitivity: Number(e.target.value) })}
                  />
                  <button
                    className="btn small"
                    disabled={!audio.current}
                    title={audio.current ? 'Vuelve a detectar las notas' : 'Vuelve a abrir la toma para analizarla otra vez'}
                    onClick={() => {
                      if (!audio.current) return;
                      if (doc.edited && !window.confirm('Volver a analizar descarta tus correcciones. ¿Continuar?')) return;
                      analyze(doc.title, [audio.current.mono], audio.current.sr, !warnWet, doc);
                    }}
                  >
                    Volver a analizar
                  </button>
                </span>
              </label>
            </div>

            <div className="tab-transport">
              {playing ? (
                <button className="btn primary-soft" onClick={stop}>
                  Parar
                </button>
              ) : (
                <>
                  <button className="btn" onClick={() => startPlay('original')} disabled={!audio.current?.buffer}>
                    Oír la grabación
                  </button>
                  <button className="btn" onClick={() => startPlay('tab')} disabled={!doc.notes.length}>
                    Oír la tablatura
                  </button>
                </>
              )}
              <label className="check inline-check">
                <input type="checkbox" checked={!!doc.showChords} onChange={(e) => setDoc({ ...doc, showChords: e.target.checked })} />
                <span>Mostrar acordes</span>
              </label>
              <span className="hint">
                {doc.notes.length} notas{sel ? ' · se reproduce desde la nota elegida' : ''}
                {doc.edited ? ' · con correcciones' : ''}
              </span>
            </div>

            <div className="tab-board" ref={boardRef} tabIndex={0} onKeyDown={onKey} aria-label="Tablatura editable">
              {Array.from({ length: bars }, (_, b) => (
                <svg
                  key={b}
                  className="tab-bar"
                  viewBox={`0 0 ${PAD * 2 + perBar * STEP_W} ${TOP + LINE_H * 5 + 14}`}
                  onClick={(e) => clickBar(e, b)}
                  role="img"
                  aria-label={`Compás ${b + 1}`}
                >
                  <text x={2} y={TOP + 5 * LINE_H + 12} className="tab-barnum">
                    {b + 1}
                  </text>
                  {chords
                    .filter((c) => c.step >= b * perBar && c.step < (b + 1) * perBar)
                    .map((c) => (
                      <text key={c.step} x={PAD + (c.step - b * perBar) * STEP_W} y={11} className="tab-chord">
                        <title>{c.latin}</title>
                        {c.name}
                      </text>
                    ))}
                  {Array.from({ length: perBar / 4 }, (_, k) => (
                    <line key={k} x1={PAD + k * 4 * STEP_W} x2={PAD + k * 4 * STEP_W} y1={TOP - 7} y2={TOP - 3} className="tab-beat" />
                  ))}
                  {[0, 1, 2, 3, 4, 5].map((row) => (
                    <line key={row} x1={PAD} x2={PAD + perBar * STEP_W} y1={TOP + row * LINE_H} y2={TOP + row * LINE_H} className="tab-line" />
                  ))}
                  <line x1={PAD} x2={PAD} y1={TOP} y2={TOP + 5 * LINE_H} className="tab-barline" />
                  <line x1={PAD + perBar * STEP_W} x2={PAD + perBar * STEP_W} y1={TOP} y2={TOP + 5 * LINE_H} className="tab-barline" />
                  {b === 0 &&
                    names.map((nm, s) => (
                      <text key={s} x={1} y={TOP + (5 - s) * LINE_H + 4} className="tab-string-name">
                        {nm}
                      </text>
                    ))}
                  {doc.notes
                    .filter((n) => n.step >= b * perBar && n.step < (b + 1) * perBar)
                    .map((n) => {
                      const x = PAD + (n.step - b * perBar) * STEP_W + STEP_W / 2;
                      const y = TOP + (5 - n.string) * LINE_H;
                      const end = Math.min(PAD + perBar * STEP_W, x + (n.dur - 0.5) * STEP_W);
                      const label = noteLabel(n);
                      return (
                        <g key={n.id} className={`tab-note${n.id === selected ? ' selected' : ''}`}>
                          <line x1={x} x2={end} y1={y} y2={y} className="tab-dur" />
                          <rect x={x - (label.length * 3.6 + 4)} y={y - 7} width={label.length * 7.2 + 8} height={14} rx={3} />
                          <text x={x} y={y + 4}>
                            {label}
                          </text>
                        </g>
                      );
                    })}
                  <line
                    ref={(el) => (el ? cursors.current.set(b, el) : cursors.current.delete(b))}
                    y1={TOP - 8}
                    y2={TOP + 5 * LINE_H + 8}
                    className="tab-cursor"
                    style={{ display: 'none' }}
                  />
                </svg>
              ))}
            </div>

            <div className="tab-editor">
              {sel ? (
                <>
                  <p>
                    <strong>
                      {midiName(sel.midi, tuning.flats).latin} {midiName(sel.midi, tuning.flats).letter}
                      {midiName(sel.midi, tuning.flats).octave}
                    </strong>{' '}
                    · cuerda {6 - sel.string}, traste {sel.fret} · compás {Math.floor(sel.step / perBar) + 1}, tiempo{' '}
                    {Math.floor((sel.step % perBar) / 4) + 1} · {sel.dur} {sel.dur === 1 ? 'semicorchea' : 'semicorcheas'}
                  </p>
                  <div className="tab-editor-buttons">
                    <span className="group">
                      Traste
                      <button className="btn small" onClick={() => updateSel({ fret: sel.fret - 1 }, true)}>−</button>
                      <button className="btn small" onClick={() => updateSel({ fret: sel.fret + 1 }, true)}>+</button>
                    </span>
                    <span className="group">
                      Misma nota en otra cuerda
                      <button className="btn small" onClick={() => moveString(1)}>Más aguda</button>
                      <button className="btn small" onClick={() => moveString(-1)}>Más grave</button>
                    </span>
                    <span className="group">
                      Duración
                      <button className="btn small" onClick={() => updateSel({ dur: sel.dur - 1 })}>−</button>
                      <button className="btn small" onClick={() => updateSel({ dur: sel.dur + 1 })}>+</button>
                    </span>
                    <span className="group">
                      Mover
                      <button className="btn small" onClick={() => updateSel({ step: sel.step - 1 })}>←</button>
                      <button className="btn small" onClick={() => updateSel({ step: sel.step + 1 })}>→</button>
                    </span>
                    <span className="group">
                      Técnica
                      <select
                        value={sel.tech?.from ?? ''}
                        onChange={(e) => setTech({ from: (e.target.value || undefined) as Legato | undefined })}
                        aria-label="Cómo se llega a esta nota"
                      >
                        <option value="">Con púa</option>
                        <option value="h">Hammer-on (h)</option>
                        <option value="p">Pull-off (p)</option>
                        <option value="/">Slide subiendo (/)</option>
                        <option value={'\\'}>Slide bajando ({'\\'})</option>
                      </select>
                      <select
                        value={sel.tech?.bend ?? 0}
                        onChange={(e) => setTech({ bend: Number(e.target.value) || undefined })}
                        aria-label="Bend"
                      >
                        <option value={0}>Sin bend</option>
                        <option value={1}>Bend ½ tono</option>
                        <option value={2}>Bend 1 tono</option>
                        <option value={3}>Bend 1½ tonos</option>
                      </select>
                      <button
                        className={`toggle${sel.tech?.vib ? ' on' : ''}`}
                        aria-pressed={!!sel.tech?.vib}
                        onClick={() => setTech({ vib: sel.tech?.vib ? undefined : true })}
                      >
                        Vibrato
                      </button>
                    </span>
                    <button className="btn small" onClick={() => preview(sel.midi, sel)}>Oír</button>
                    <button className="btn small ghost danger" onClick={remove}>Borrar</button>
                  </div>
                </>
              ) : (
                <p className="hint">
                  Toca una nota para elegirla, o un hueco de una cuerda para añadir una. Con la tablatura enfocada: números
                  para el traste, ← → para pasar de nota, Mayús + ← → para moverla, ↑ ↓ para cambiar de cuerda, + − para la
                  duración y Supr para borrar.
                </p>
              )}
            </div>

            {uniqueChords.length > 0 && (
              <div className="chord-list">
                <h3>Acordes</h3>
                <div className="chord-cards">
                  {uniqueChords.map((c) => (
                    <ChordCard key={c.name} name={c.name} latin={c.latin} shape={tuning.id === 'standard' ? chordShape(c.root, c.quality) : null} />
                  ))}
                </div>
                {tuning.id !== 'standard' && <p className="hint">Los diagramas solo se muestran en afinación estándar.</p>}
              </div>
            )}

            <details className="help">
              <summary>Tablatura en texto</summary>
              <pre className="tab-ascii">{ascii}</pre>
              <div className="control-buttons">
                <button className="btn small" onClick={() => navigator.clipboard?.writeText(ascii)}>
                  Copiar
                </button>
                <button
                  className="btn small"
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(new Blob([ascii], { type: 'text/plain' }));
                    a.download = `${doc.title || 'tablatura'}.txt`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
                  }}
                >
                  Descargar .txt
                </button>
              </div>
            </details>
          </>
        )}

        <details className="help guide">
          <summary>Cómo sacar una buena tablatura</summary>
          <ol>
            <li>
              <strong>Graba en seco</strong>: la distorsión y los efectos confunden la detección de notas.
            </li>
            <li>
              <strong>Graba con metrónomo</strong> y usa el mismo tempo aquí («Metrónomo»): así el ritmo sale en su sitio.
              Si la primera nota no cae en el tiempo 1, cambia «Inicio del compás 1».
            </li>
            <li>
              <strong>Detección:</strong> «Notas sueltas» es rápida y muy fiable para riffs, melodías y solos, y reconoce
              hammer-ons, pull-offs, slides, bends y vibratos. «Acordes y notas (IA)» usa un modelo de inteligencia
              artificial para sacar también los acordes cuerda a cuerda; la primera vez descarga unos megas y en móviles
              modestos tarda más.
            </li>
            <li>
              Revisa el resultado con <strong>Oír la tablatura</strong> y corrige lo que no cuadre. Si salen notas de más
              (ruidos de púa), baja la sensibilidad; si faltan, súbela.
            </li>
          </ol>
          <p>
            Notación de técnicas: h (hammer-on), p (pull-off), / y {'\\'} (slides), 7b9 (bend desde el traste 7 hasta el sonido
            del 9) y ~ (vibrato). Los nombres de acorde se calculan a partir de las notas de cada medio compás.
          </p>
          <p>
            La cuerda y el traste se eligen buscando la digitación que menos mueve la mano. Si tocaste en otra posición,
            usa «Misma nota en otra cuerda».
          </p>
        </details>
      </section>
    </div>
  );
}

/** Diagrama de acorde: 6 cuerdas, 4 trastes, puntos, cuerdas al aire (o) y sin tocar (x). */
function ChordCard({ name, latin, shape }: { name: string; latin: string; shape: number[] | null }) {
  const fretted = shape?.filter((f) => f > 0) ?? [];
  const base = fretted.length && Math.max(...fretted) > 4 ? Math.min(...fretted) : 1;
  const W = 70;
  const H = 86;
  const x = (s: number) => 10 + s * 10;
  const y = (f: number) => 18 + (f - base + 0.5) * 15;
  return (
    <figure className="chord-card" title={latin}>
      <figcaption>
        <strong>{name}</strong>
        <span>{latin}</span>
      </figcaption>
      {shape ? (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Diagrama de ${latin}`}>
          {[0, 1, 2, 3, 4].map((k) => (
            <line key={k} x1={10} x2={60} y1={18 + k * 15} y2={18 + k * 15} className={k === 0 && base === 1 ? 'nut' : 'fret'} />
          ))}
          {[0, 1, 2, 3, 4, 5].map((s) => (
            <line key={s} x1={x(s)} x2={x(s)} y1={18} y2={78} className="string" />
          ))}
          {base > 1 && (
            <text x={64} y={y(base) + 3} className="base">
              {base}
            </text>
          )}
          {shape.map((f, s) =>
            f < 0 ? (
              <text key={s} x={x(s)} y={13} className="mark">
                ×
              </text>
            ) : f === 0 ? (
              <circle key={s} cx={x(s)} cy={10} r={3} className="open" />
            ) : (
              <circle key={s} cx={x(s)} cy={y(f)} r={4} className="dot" />
            )
          )}
        </svg>
      ) : (
        <p className="hint">Sin diagrama</p>
      )}
    </figure>
  );
}
