import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeBoard, type BoardState } from './audio/chain';
import { AudioEngine, type ChannelMode, type LatencyInfo, type RecordSource } from './audio/engine';
import { LevelMeter } from './components/LevelMeter';
import { LooperTab } from './components/LooperTab';
import { Pedalboard } from './components/Pedalboard';
import { PresetBar } from './components/PresetBar';
import { Recorder } from './components/Recorder';
import { Studio } from './components/Studio';
import { encodeWav } from './audio/wav';
import { saveRecording, type Recording } from './storage/recordings';
import { Tuner } from './components/Tuner';
import {
  deletePreset,
  exportPresets,
  FACTORY_PRESETS,
  listUserPresets,
  parsePresetFile,
  sameBoard,
  savePreset,
  type Preset
} from './presets';
import { useSettings, type TabName } from './settings';
import { ThemeSelect, useTheme } from './theme';
import { decodeIr, deleteIr, getIr, listIrs, MAX_IR_BYTES, saveIr, type StoredIr } from './storage/irs';

const BOARD_KEY = 'guitart:board';
const PRESET_KEY = 'guitart:preset';

function loadBoard(): BoardState {
  try {
    const saved = localStorage.getItem(BOARD_KEY);
    if (saved) return normalizeBoard(JSON.parse(saved));
  } catch {
    /* estado guardado no válido */
  }
  return FACTORY_PRESETS[0].board;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Phase = 'idle' | 'starting' | 'running';

const TABS: { value: TabName; label: string }[] = [
  { value: 'audio', label: 'Afinador y audio' },
  { value: 'board', label: 'Pedalera y grabación' },
  { value: 'looper', label: 'Looper y ritmo' },
  { value: 'studio', label: 'Estudio' }
];

function describeError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'El navegador ha bloqueado el acceso al audio. Pulsa el icono junto a la dirección web, permite el micrófono y vuelve a intentarlo.';
    case 'NotFoundError':
      return 'No hay ninguna entrada de audio disponible. Conecta la interfaz USB o comprueba el micrófono.';
    case 'NotReadableError':
      return 'Otra aplicación está usando la entrada de audio. Ciérrala y vuelve a intentarlo.';
    default:
      return `No se ha podido abrir el audio: ${e instanceof Error ? e.message : String(e)}`;
  }
}

const CHANNELS: { value: ChannelMode; label: string }[] = [
  { value: 'left', label: 'Canal 1' },
  { value: 'right', label: 'Canal 2' },
  { value: 'stereo', label: 'Estéreo' }
];

export default function App() {
  const engine = useRef(new AudioEngine()).current;
  const [settings, update] = useSettings();
  useTheme(settings.theme);
  const tab = settings.tab;
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [channelCount, setChannelCount] = useState<number>(2);
  const [monitorOn, setMonitorOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [tunerMute, setTunerMute] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measureMsg, setMeasureMsg] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [studioBusy, setStudioBusy] = useState(false);
  const [takesVersion, setTakesVersion] = useState(0);
  const [latency, setLatency] = useState<LatencyInfo | null>(null);
  const [board, setBoard] = useState<BoardState>(loadBoard);
  const [presetId, setPresetId] = useState<string>(() => localStorage.getItem(PRESET_KEY) ?? FACTORY_PRESETS[0].id);
  const [userPresets, setUserPresets] = useState<Preset[]>([]);
  const [irs, setIrs] = useState<StoredIr[]>([]);
  const irCache = useRef(new Map<string, AudioBuffer>());

  useEffect(() => {
    listUserPresets().then(setUserPresets).catch(() => undefined);
    listIrs().then(setIrs).catch(() => undefined);
  }, []);

  const loadIr = useCallback(
    async (id: string) => {
      if (!engine.ctx) return null;
      // La IR se decodifica a la frecuencia del contexto, que puede cambiar al cambiar de interfaz
      const key = `${id}@${engine.ctx.sampleRate}`;
      const cached = irCache.current.get(key);
      if (cached) return cached;
      const rec = await getIr(id);
      if (!rec || !engine.ctx) return null;
      const buf = await decodeIr(engine.ctx, rec.blob);
      irCache.current.set(key, buf);
      return buf;
    },
    [engine]
  );

  const uploadIr = async (file: File) => {
    if (file.size > MAX_IR_BYTES) {
      setError('El archivo pesa más de 5 MB. Las IR de altavoz suelen ocupar menos de 200 KB.');
      return;
    }
    try {
      if (!engine.ctx) throw new Error('audio');
      await decodeIr(engine.ctx, file); // comprueba que es audio válido antes de guardarlo
      const ir: StoredIr = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'IR',
        createdAt: Date.now(),
        blob: file
      };
      await saveIr(ir);
      setIrs(await listIrs());
      setBoard((b) =>
        b.map((p) => (p.type === 'cab' ? { ...p, enabled: true, ir: ir.id, params: { ...p.params, model: 3 } } : p))
      );
      setError(null);
    } catch {
      setError('No se ha podido leer el archivo. Usa un WAV con la respuesta al impulso (IR) de un altavoz.');
    }
  };

  const removeIr = async (id: string) => {
    const ir = irs.find((i) => i.id === id);
    if (!window.confirm(`¿Borrar la IR «${ir?.name ?? ''}» de este navegador?`)) return;
    await deleteIr(id);
    for (const key of irCache.current.keys()) if (key.startsWith(`${id}@`)) irCache.current.delete(key);
    setIrs(await listIrs());
    setBoard((b) => b.map((p) => (p.type === 'cab' && p.ir === id ? { ...p, ir: undefined } : p)));
  };

  useEffect(() => {
    try {
      localStorage.setItem(BOARD_KEY, JSON.stringify(board));
      localStorage.setItem(PRESET_KEY, presetId);
    } catch {
      /* almacenamiento no disponible */
    }
  }, [board, presetId]);

  useEffect(() => {
    if (phase === 'running') engine.applyBoard(board);
  }, [engine, phase, board]);

  // Pantalla siempre encendida mientras el audio está activo
  useEffect(() => {
    if (phase !== 'running' || !settings.wakeLock || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let disposed = false;
    const request = async () => {
      try {
        const l = await navigator.wakeLock.request('screen');
        if (disposed) l.release();
        else lock = l;
      } catch {
        /* el sistema puede denegarlo (batería baja, etc.) */
      }
    };
    request();
    const onVisible = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => undefined);
    };
  }, [phase, settings.wakeLock]);

  // Android suspende el audio en segundo plano: al volver a la app se reanuda
  useEffect(() => {
    if (phase !== 'running') return;
    const onVisible = () => document.visibilityState === 'visible' && engine.resume();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [phase, engine]);

  useEffect(() => engine.setTunerMute(tunerMute), [engine, tunerMute]);

  const latencyKey = `${settings.inputId}|${settings.outputId}|${settings.lowLatency ? 'min' : 'normal'}`;
  const measuredMs = settings.measured[latencyKey];

  const measureLatency = async () => {
    setMeasuring(true);
    setMeasureMsg(null);
    try {
      const r = await engine.measureLatency();
      if (r) {
        update({ measured: { ...settings.measured, [latencyKey]: Math.round(r.ms * 10) / 10 } });
        setMeasureMsg(`Detectados ${r.clicks} de 6 clics.`);
      } else {
        setMeasureMsg('No se han detectado los clics. Revisa que el sonido de la salida llegue a la entrada y vuelve a probar.');
      }
    } finally {
      setMeasuring(false);
    }
  };

  const toggleLowLatency = async (on: boolean) => {
    setSwitching(true);
    try {
      await engine.setLowLatency(on);
      update({ lowLatency: on });
      setLatency(engine.latency());
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSwitching(false);
    }
  };

  /** Cargador de IR para un contexto concreto (el re-amp usa su propio contexto fuera de tiempo real). */
  const irLoaderFor = useCallback(
    (ctx: BaseAudioContext) => async (id: string) => {
      const rec = await getIr(id);
      return rec ? decodeIr(ctx, rec.blob) : null;
    },
    []
  );

  const reampTake = async (rec: Recording): Promise<Recording> => {
    if (!engine.ctx) throw new Error('audio');
    const decoded = await engine.ctx.decodeAudioData(await rec.blob.arrayBuffer());
    const input = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c));
    const out = await engine.reamp(input, decoded.sampleRate, board, irLoaderFor);
    const created: Recording = {
      id: crypto.randomUUID(),
      name: `${rec.name} (re-amp${currentPreset ? `: ${currentPreset.name}` : ''})`.slice(0, 80),
      createdAt: Date.now(),
      duration: out[0].length / decoded.sampleRate,
      sampleRate: decoded.sampleRate,
      channels: 2,
      source: 'wet',
      blob: encodeWav(out, decoded.sampleRate)
    };
    await saveRecording(created);
    return created;
  };

  const autoGate = async () => {
    const floor = await engine.measureNoiseFloor(2000);
    const threshold = Number.isFinite(floor) ? Math.max(-90, Math.min(-20, Math.round(floor + 6))) : -80;
    setBoard((b) =>
      b.map((p) => (p.type === 'gate' ? { ...p, enabled: true, params: { ...p.params, threshold } } : p))
    );
    return threshold;
  };

  const currentPreset = [...FACTORY_PRESETS, ...userPresets].find((p) => p.id === presetId);
  const modified = !currentPreset || !sameBoard(currentPreset.board, board);

  const loadPreset = (id: string) => {
    const p = [...FACTORY_PRESETS, ...userPresets].find((x) => x.id === id);
    if (!p) return;
    setPresetId(id);
    setBoard(p.board);
  };

  const storeUserPreset = async (p: Preset) => {
    await savePreset(p);
    setUserPresets(await listUserPresets());
    setPresetId(p.id);
  };

  const presetError = (e: unknown) =>
    setError(e instanceof Error ? e.message : 'No se ha podido guardar el preset en este navegador.');

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    setInputs(all.filter((d) => d.kind === 'audioinput'));
    setOutputs(all.filter((d) => d.kind === 'audiooutput'));
  }, []);

  const open = useCallback(
    async (deviceId: string) => {
      let track: MediaTrackSettings;
      try {
        track = await engine.openInput(deviceId || undefined);
      } catch (e) {
        // La interfaz guardada ya no está conectada: usar la entrada por defecto
        if (deviceId && e instanceof DOMException && e.name === 'OverconstrainedError') {
          track = await engine.openInput();
        } else throw e;
      }
      setChannelCount(track.channelCount ?? 2);
      if (track.deviceId && track.deviceId !== deviceId) update({ inputId: track.deviceId });
      setLatency(engine.latency());
    },
    [engine, update]
  );

  const start = async () => {
    setPhase('starting');
    setError(null);
    engine.setIrLoader(loadIr);
    await engine.setLowLatency(settings.lowLatency);
    try {
      await open(settings.inputId);
      engine.setChannelMode(settings.channelMode);
      engine.setInputGainDb(settings.gainDb);
      engine.setRecordSource(settings.recordSource);
      await refreshDevices();
      if (settings.outputId) await engine.setOutputDevice(settings.outputId).catch(() => update({ outputId: '' }));
      setPhase('running');
    } catch (e) {
      setError(describeError(e));
      setPhase('idle');
    }
  };

  useEffect(() => {
    if (phase !== 'running') return;
    const md = navigator.mediaDevices;
    md.addEventListener('devicechange', refreshDevices);
    const id = window.setInterval(() => setLatency(engine.latency()), 2000);
    return () => {
      md.removeEventListener('devicechange', refreshDevices);
      window.clearInterval(id);
    };
  }, [phase, engine, refreshDevices]);

  useEffect(() => engine.setMonitor(monitorOn, settings.monitorVolume), [engine, monitorOn, settings.monitorVolume]);

  const changeInput = async (id: string) => {
    setMonitorOn(false);
    update({ inputId: id });
    try {
      await open(id);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  };

  const changeChannel = (mode: ChannelMode) => {
    update({ channelMode: mode });
    engine.setChannelMode(mode);
  };

  const changeGain = (db: number) => {
    update({ gainDb: db });
    engine.setInputGainDb(db);
  };

  const changeOutput = async (id: string) => {
    try {
      await engine.setOutputDevice(id);
      update({ outputId: id });
    } catch (e) {
      setError(describeError(e));
    }
  };

  const currentInput = inputs.find((d) => d.deviceId === settings.inputId);
  const looksLikeMic = !currentInput || /micr|mic |built-in|integrad|interno|default|predeterminado/i.test(currentInput.label);

  if (phase !== 'running') {
    return (
      <main className="intro">
        <div className="intro-top">
          <ThemeSelect value={settings.theme} onChange={(theme) => update({ theme })} />
        </div>
        <h1 className="wordmark">Guitart</h1>
        <p className="lede">Afinador, amplificador, pedalera de efectos y grabación para tu guitarra, directamente en el navegador.</p>
        <button className="btn primary big" onClick={start} disabled={phase === 'starting'}>
          {phase === 'starting' ? 'Abriendo audio…' : 'Activar audio'}
        </button>
        {error && <p className="notice error">{error}</p>}
        <ul className="intro-notes">
          <li>Conecta la interfaz USB antes de activar el audio. Si no tienes, sirve el micrófono del equipo.</li>
          <li>Si vas a escuchar la señal con el micrófono, usa auriculares para evitar acoples.</li>
          <li>Funciona mejor en Chrome o Edge, en ordenador o Android.</li>
        </ul>
      </main>
    );
  }

  const totalLatency = latency ? latency.outputMs + (latency.inputMs ?? 0) : 0;

  return (
    <div className="app">
      <div className="chrome">
      <header className="topbar">
        <h1 className="wordmark small">Guitart</h1>
        <div className="topbar-right">
        {latency && (
          <dl className="status">
            <div>
              <dt>Muestreo</dt>
              <dd>{(latency.sampleRate / 1000).toFixed(1)} kHz</dd>
            </div>
            <div>
              <dt>{measuredMs != null ? 'Latencia medida' : 'Latencia estimada'}</dt>
              <dd className={(measuredMs ?? totalLatency) > 30 ? 'warn' : undefined}>
                {(measuredMs ?? totalLatency).toFixed(0)} ms
              </dd>
            </div>
          </dl>
        )}
        <ThemeSelect value={settings.theme} onChange={(theme) => update({ theme })} />
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Secciones">
        {TABS.map((t, i) => (
          <button
            key={t.value}
            id={`tab-${t.value}`}
            role="tab"
            aria-selected={tab === t.value}
            aria-controls={`panel-${t.value}`}
            tabIndex={tab === t.value ? 0 : -1}
            onClick={(e) => {
              update({ tab: t.value });
              e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
              update({ tab: next.value });
              document.getElementById(`tab-${next.value}`)?.focus();
            }}
          >
            {t.label}
            {((t.value === 'board' && recording) || (t.value === 'studio' && studioBusy)) && (
              <span className="tab-rec">
                <span className="rec-dot" aria-hidden="true" />
                Grabando
              </span>
            )}
          </button>
        ))}
      </nav>
      </div>

      {error && <p className="notice error">{error}</p>}

      <div className="layout audio" role="tabpanel" id="panel-audio" aria-labelledby="tab-audio" hidden={tab !== 'audio'}>
        <Tuner
          engine={engine}
          a4={settings.a4}
          onA4={(a4) => update({ a4 })}
          active={tab === 'audio'}
          tuningId={settings.tuning}
          onTuning={(tuning) => update({ tuning })}
          muted={tunerMute}
          onMute={setTunerMute}
        />

        <section className="panel input" aria-labelledby="input-title">
          <div className="panel-head">
            <h2 id="input-title">Entrada</h2>
          </div>

          <label className="field">
            <span>Dispositivo</span>
            <select value={settings.inputId} onChange={(e) => changeInput(e.target.value)} disabled={recording}>
              {inputs.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Entrada ${i + 1}`}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <span id="ch-label">Canal de la guitarra</span>
            <div className="segmented" role="group" aria-labelledby="ch-label">
              {CHANNELS.map((c) => (
                <button
                  key={c.value}
                  aria-pressed={settings.channelMode === c.value}
                  onClick={() => changeChannel(c.value)}
                  disabled={recording || (channelCount < 2 && c.value !== 'left')}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {channelCount < 2 && <small className="hint">Esta entrada es mono.</small>}
          </div>

          <label className="field">
            <span>
              Ganancia <output>{settings.gainDb > 0 ? '+' : ''}{settings.gainDb} dB</output>
            </span>
            <input
              type="range"
              min={-24}
              max={24}
              step={1}
              value={settings.gainDb}
              onChange={(e) => changeGain(Number(e.target.value))}
              onDoubleClick={() => changeGain(0)}
            />
          </label>

          <LevelMeter engine={engine} active={tab === 'audio'} />
        </section>

        <div className="stack">
        <section className="panel monitor" aria-labelledby="monitor-title">
          <div className="panel-head">
            <h2 id="monitor-title">Escucha</h2>
            <button
              className={`switch${monitorOn ? ' on' : ''}`}
              role="switch"
              aria-checked={monitorOn}
              onClick={() => setMonitorOn((v) => !v)}
            >
              <span className="lamp" aria-hidden="true" />
              {monitorOn ? 'Activada' : 'Desactivada'}
            </button>
          </div>

          {looksLikeMic && (
            <p className="notice">Con el micrófono del equipo, activa la escucha solo con auriculares para evitar acoples.</p>
          )}

          <label className="field">
            <span>
              Volumen <output>{Math.round(settings.monitorVolume * 100)} %</output>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.monitorVolume}
              onChange={(e) => update({ monitorVolume: Number(e.target.value) })}
            />
          </label>

          {engine.canChooseOutput ? (
            <label className="field">
              <span>Salida</span>
              <select value={settings.outputId} onChange={(e) => changeOutput(e.target.value)}>
                <option value="">Salida del sistema</option>
                {outputs
                  .filter((d) => d.deviceId && d.deviceId !== 'default')
                  .map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Salida ${i + 1}`}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <p className="hint">Este navegador usa la salida de audio del sistema.</p>
          )}

        </section>
        <section className="panel latency" aria-labelledby="latency-title">
          <div className="panel-head">
            <h2 id="latency-title">Latencia</h2>
          </div>
            {latency && (
              <dl className="latency-values">
                <div>
                  <dt>Estimada por el navegador</dt>
                  <dd>{totalLatency.toFixed(1)} ms</dd>
                </div>
                <div>
                  <dt>Medida (ida y vuelta)</dt>
                  <dd>{measuredMs != null ? `${measuredMs.toFixed(1)} ms` : 'Sin medir'}</dd>
                </div>
              </dl>
            )}
            <p className="hint">Por debajo de 20 ms se toca con comodidad. Nunca escuches por Bluetooth: añade más de 150 ms.</p>
            <button className="btn" onClick={measureLatency} disabled={measuring || recording || switching}>
              {measuring ? 'Midiendo…' : 'Medir latencia'}
            </button>
            {measureMsg && <p className="hint">{measureMsg}</p>}
            <details className="help">
              <summary>Cómo funciona la medición</summary>
              <p>
                La app emite seis clics por la salida y los busca en la entrada. El tiempo que tardan en volver es la
                latencia real de ida y vuelta, la que notas al tocar.
              </p>
              <p>
                Para que funcione, el sonido de la salida tiene que llegar a la entrada: con el micrófono del equipo, usa los
                altavoces a volumen medio; con una interfaz, conecta un cable de su salida a una de sus entradas o activa su
                función de loopback si la tiene. La guitarra no capta el sonido, así que con ella sola la medición no
                funciona.
              </p>
              <p>Baja el volumen de los auriculares antes de medir: los clics son cortos pero agudos.</p>
            </details>

            <label className="check">
              <input
                type="checkbox"
                checked={settings.lowLatency}
                disabled={switching || recording}
                onChange={(e) => toggleLowLatency(e.target.checked)}
              />
              <span>
                Latencia mínima
                <small>Pide al navegador el búfer de audio más pequeño. Si oyes cortes o chasquidos, desactívalo.</small>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.wakeLock} onChange={(e) => update({ wakeLock: e.target.checked })} />
              <span>
                Mantener la pantalla encendida
                <small>Evita que el móvil se bloquee mientras tocas.</small>
              </span>
            </label>
        </section>
        </div>

      </div>

      <div className="layout studio" role="tabpanel" id="panel-board" aria-labelledby="tab-board" hidden={tab !== 'board'}>
        <section className="panel board" aria-labelledby="board-title">
          <div className="panel-head wrap">
            <h2 id="board-title">Pedalera</h2>
            <PresetBar
              factory={FACTORY_PRESETS}
              user={userPresets}
              current={currentPreset}
              modified={modified}
              onLoad={loadPreset}
              onSave={() => currentPreset && storeUserPreset({ ...currentPreset, board }).catch(presetError)}
              onSaveAs={(name) => storeUserPreset({ id: crypto.randomUUID(), name, board }).catch(presetError)}
              onDelete={async () => {
                if (!currentPreset || currentPreset.factory) return;
                if (!window.confirm(`¿Borrar el preset «${currentPreset.name}»?`)) return;
                await deletePreset(currentPreset.id);
                setUserPresets(await listUserPresets());
                setPresetId('');
              }}
              onExport={() => {
                const name = currentPreset?.name ?? 'Guitart';
                download(exportPresets([{ id: '', name, board }]), `${name}.guitart.json`);
              }}
              onImport={async (file) => {
                try {
                  const imported = parsePresetFile(await file.text());
                  for (const p of imported) await savePreset(p);
                  setUserPresets(await listUserPresets());
                  setPresetId(imported[0].id);
                  setBoard(imported[0].board);
                  setError(null);
                } catch (e) {
                  setError(
                    e instanceof SyntaxError ? 'El archivo no es un JSON válido.' : e instanceof Error ? e.message : String(e)
                  );
                }
              }}
            />
          </div>
          <p className="hint flow">La señal entra por el pedal 1 y sale por el último. Arrastra un pedal por su número para cambiar el orden.</p>
          <Pedalboard
            board={board}
            onChange={setBoard}
            ir={{ irs, onUploadIr: uploadIr, onDeleteIr: removeIr }}
            onAutoGate={autoGate}
          />
        </section>

        <Recorder
          engine={engine}
          version={takesVersion}
          onReamp={reampTake}
          blocked={studioBusy}
          source={settings.recordSource}
          onSource={(s: RecordSource) => {
            update({ recordSource: s });
            engine.setRecordSource(s);
          }}
          onRecordingChange={setRecording}
        />
      </div>

      <div className="layout" role="tabpanel" id="panel-looper" aria-labelledby="tab-looper" hidden={tab !== 'looper'}>
        <LooperTab engine={engine} active={tab === 'looper'} latencyMs={measuredMs ?? totalLatency} />
      </div>

      <div className="layout" role="tabpanel" id="panel-studio" aria-labelledby="tab-studio" hidden={tab !== 'studio'}>
        <Studio
          engine={engine}
          active={tab === 'studio'}
          latencyMs={measuredMs ?? totalLatency}
          busy={recording}
          onBusy={(on) => {
            setStudioBusy(on);
          }}
          board={board}
          irLoaderFor={irLoaderFor}
          onTakeSaved={() => setTakesVersion((v) => v + 1)}
          theme={settings.theme}
        />
      </div>
    </div>
  );
}