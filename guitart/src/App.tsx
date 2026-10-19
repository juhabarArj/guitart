import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine, type ChannelMode, type LatencyInfo } from './audio/engine';
import { LevelMeter } from './components/LevelMeter';
import { Recorder } from './components/Recorder';
import { Tuner } from './components/Tuner';
import { useSettings } from './settings';

type Phase = 'idle' | 'starting' | 'running';

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
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [channelCount, setChannelCount] = useState<number>(2);
  const [monitorOn, setMonitorOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [latency, setLatency] = useState<LatencyInfo | null>(null);

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
    try {
      await open(settings.inputId);
      engine.setChannelMode(settings.channelMode);
      engine.setInputGainDb(settings.gainDb);
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
        <h1 className="wordmark">Guitart</h1>
        <p className="lede">Afinador, monitor y grabación para tu guitarra, directamente en el navegador.</p>
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
      <header className="topbar">
        <h1 className="wordmark small">Guitart</h1>
        {latency && (
          <dl className="status">
            <div>
              <dt>Muestreo</dt>
              <dd>{(latency.sampleRate / 1000).toFixed(1)} kHz</dd>
            </div>
            <div>
              <dt>Latencia estimada</dt>
              <dd className={totalLatency > 30 ? 'warn' : undefined}>{totalLatency.toFixed(0)} ms</dd>
            </div>
          </dl>
        )}
      </header>

      {error && <p className="notice error">{error}</p>}

      <div className="layout">
        <Tuner engine={engine} a4={settings.a4} onA4={(a4) => update({ a4 })} />

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

          <LevelMeter engine={engine} />
        </section>

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

          {latency && (
            <p className="hint">
              Salida {latency.outputMs.toFixed(1)} ms
              {latency.inputMs != null ? `, entrada ${latency.inputMs.toFixed(1)} ms` : ''}. Por debajo de 20 ms se toca con
              comodidad.
            </p>
          )}
        </section>

        <Recorder engine={engine} onRecordingChange={setRecording} />
      </div>
    </div>
  );
}
