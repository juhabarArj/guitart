import { useEffect, useState } from 'react';
import { ACTIONS, bindingLabel, DEFAULT_BINDINGS, type ActionId, type Bindings } from '../control/actions';
import { controlInputs, type ControlEvent } from '../control/inputs';
import { exportBackup, readBackup, restoreBackup, type BackupSummary } from '../storage/backup';

interface Props {
  bindings: Bindings;
  onBindings: (b: Bindings) => void;
  learning: ActionId | null;
  onLearn: (id: ActionId | null) => void;
  lastEvent: ControlEvent | null;
  midiPc: boolean;
  onMidiPc: (on: boolean) => void;
}

const GROUPS = [...new Set(ACTIONS.map((a) => a.group))];

export function ControlTab({ bindings, onBindings, learning, onLearn, lastEvent, midiPc, onMidiPc }: Props) {
  const [devices, setDevices] = useState<string[]>(controlInputs.devices());
  const [midiOn, setMidiOn] = useState(controlInputs.midiEnabled);
  const [msg, setMsg] = useState<string | null>(null);
  const [includeAudio, setIncludeAudio] = useState(false);
  const [working, setWorking] = useState(false);
  const [pending, setPending] = useState<BackupSummary | null>(null);

  useEffect(() => {
    controlInputs.onDevicesChange = () => setDevices(controlInputs.devices());
    return () => {
      controlInputs.onDevicesChange = null;
    };
  }, []);

  const enableMidi = async () => {
    try {
      await controlInputs.enableMidi();
      setMidiOn(true);
      setDevices(controlInputs.devices());
      setMsg(null);
    } catch {
      setMsg('El navegador no ha permitido el acceso a MIDI.');
    }
  };

  const connectBle = async () => {
    try {
      const name = await controlInputs.connectBle();
      setMsg(`Conectado: ${name}.`);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return; // el usuario canceló
      setMsg('No se ha podido conectar. Comprueba que el pedal está en modo Bluetooth MIDI y encendido.');
    }
  };

  const remove = (id: ActionId, b: string) => onBindings({ ...bindings, [id]: (bindings[id] ?? []).filter((x) => x !== b) });

  const doExport = async () => {
    setWorking(true);
    try {
      const blob = await exportBackup(includeAudio);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `guitart-copia-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setMsg(`Copia descargada (${(blob.size / 1024 / 1024).toFixed(1)} MB).`);
    } finally {
      setWorking(false);
    }
  };

  const pickBackup = async (file: File) => {
    try {
      setPending(readBackup(await file.text()));
      setMsg(null);
    } catch (e) {
      setMsg(e instanceof SyntaxError ? 'El archivo no es un JSON válido.' : e instanceof Error ? e.message : String(e));
    }
  };

  const doRestore = async () => {
    if (!pending) return;
    setWorking(true);
    try {
      await restoreBackup(pending.file);
      window.location.reload();
    } catch {
      setMsg('No se ha podido restaurar la copia.');
      setWorking(false);
    }
  };

  return (
    <div className="control-layout">
      <section className="panel" aria-labelledby="shortcuts-title">
        <div className="panel-head wrap">
          <h2 id="shortcuts-title">Atajos y pedales</h2>
          <button className="btn ghost" onClick={() => window.confirm('¿Volver a las asignaciones por defecto?') && onBindings(DEFAULT_BINDINGS)}>
            Restablecer
          </button>
        </div>
        <p className="hint">
          Funcionan desde cualquier pestaña. Pulsa <strong>Asignar</strong> y después la tecla o el pedal que quieras usar.
        </p>
        {learning && (
          <p className="notice learn" role="status">
            Esperando una tecla o un mensaje MIDI para «{ACTIONS.find((a) => a.id === learning)?.label}»…{' '}
            <button className="btn small ghost" onClick={() => onLearn(null)}>
              Cancelar
            </button>
          </p>
        )}
        {GROUPS.map((g) => (
          <div key={g} className="action-group">
            <h3>{g}</h3>
            <ul className="actions">
              {ACTIONS.filter((a) => a.group === g).map((a) => (
                <li key={a.id} className={learning === a.id ? 'learning' : undefined}>
                  <span className="action-label">{a.label}</span>
                  <span className="chips">
                    {(bindings[a.id] ?? []).map((b) => (
                      <span key={b} className="chip">
                        {bindingLabel(b)}
                        <button onClick={() => remove(a.id, b)} aria-label={`Quitar ${bindingLabel(b)}`}>
                          ×
                        </button>
                      </span>
                    ))}
                  </span>
                  <button className="btn small" onClick={() => onLearn(learning === a.id ? null : a.id)}>
                    {learning === a.id ? 'Esperando…' : 'Asignar'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <div className="stack">
        <section className="panel" aria-labelledby="midi-title">
          <div className="panel-head">
            <h2 id="midi-title">MIDI y Bluetooth</h2>
          </div>
          <div className="control-buttons">
            {controlInputs.midiSupported ? (
              <button className="btn" onClick={enableMidi} disabled={midiOn}>
                {midiOn ? 'MIDI activado' : 'Activar MIDI'}
              </button>
            ) : (
              <p className="hint">Este navegador no admite MIDI. Usa Chrome o Edge.</p>
            )}
            {controlInputs.bleSupported ? (
              <button className="btn" onClick={connectBle}>
                Conectar pedal Bluetooth
              </button>
            ) : (
              <p className="hint">Este navegador no admite Bluetooth. Usa Chrome o Edge en ordenador o Android.</p>
            )}
          </div>
          {msg && <p className="hint">{msg}</p>}
          <dl className="midi-info">
            <div>
              <dt>Dispositivos</dt>
              <dd>{devices.length ? devices.join(', ') : 'Ninguno conectado'}</dd>
            </div>
            <div>
              <dt>Último mensaje</dt>
              <dd>
                {lastEvent ? `${bindingLabel(`midi:${lastEvent.key}`)}${lastEvent.key.startsWith('cc') ? ` = ${lastEvent.value}` : ''} · ${lastEvent.device}` : '—'}
              </dd>
            </div>
          </dl>
          <label className="check">
            <input type="checkbox" checked={midiPc} onChange={(e) => onMidiPc(e.target.checked)} />
            <span>
              Los cambios de programa eligen preset
              <small>Programa 1 = primer preset de la lista, programa 2 = el segundo… (salvo que lo hayas asignado a otra acción).</small>
            </span>
          </label>
          <details className="help">
            <summary>Qué pedal sirve y cómo se conecta</summary>
            <p>
              <strong>Pedales y controladores MIDI por cable o USB:</strong> conéctalos al ordenador o al móvil (con
              adaptador OTG), pulsa Activar MIDI y asigna cada interruptor a una acción.
            </p>
            <p>
              <strong>Pedales Bluetooth MIDI</strong> (muchos pedales de 4 interruptores lo son): ponlos en modo MIDI,
              pulsa Conectar pedal Bluetooth y elígelo en la lista que muestra el navegador.
            </p>
            <p>
              <strong>Pedales pasapáginas o «de teclado»:</strong> se comportan como un teclado y no hace falta conectar
              nada aquí. Empareja el pedal con el sistema y asigna sus teclas (suelen ser Av Pág, Re Pág o las flechas) con
              el botón Asignar.
            </p>
            <p>
              La MG-30 se puede usar como controlador si envía mensajes MIDI por USB: actívalos en su configuración MIDI y
              aparecerá en Dispositivos.
            </p>
          </details>
        </section>

        <section className="panel" aria-labelledby="backup-title">
          <div className="panel-head">
            <h2 id="backup-title">Copia de seguridad</h2>
          </div>
          <p className="hint">
            Guarda en un archivo tus presets, IR y ajustes (temas, atajos, ritmo…), para pasarlos a otro dispositivo o
            tenerlos a salvo.
          </p>
          <label className="check">
            <input type="checkbox" checked={includeAudio} onChange={(e) => setIncludeAudio(e.target.checked)} />
            <span>
              Incluir tomas y proyecto del Estudio
              <small>El archivo puede ocupar mucho: unos 15 MB por minuto de audio.</small>
            </span>
          </label>
          <div className="control-buttons">
            <button className="btn" onClick={doExport} disabled={working}>
              {working ? 'Preparando…' : 'Descargar copia'}
            </button>
            <label className="btn ghost file-btn">
              Restaurar copia…
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pickBackup(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {pending && (
            <div className="notice">
              <p>
                La copia contiene {pending.counts.presets ?? 0} presets, {pending.counts.irs ?? 0} IR
                {pending.counts.recordings != null ? `, ${pending.counts.recordings} tomas` : ''}
                {pending.counts.studio ? ' y el proyecto del Estudio' : ''}. Los ajustes actuales se sustituirán y la app se
                recargará.
              </p>
              <div className="control-buttons">
                <button className="btn primary-soft" onClick={doRestore} disabled={working}>
                  Restaurar
                </button>
                <button className="btn ghost" onClick={() => setPending(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
