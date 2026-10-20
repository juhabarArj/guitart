import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioEngine, RecordSource } from '../audio/engine';
import { encodeWav } from '../audio/wav';
import { useAction, type Register } from '../control/registry';
import { deleteRecording, listRecordings, saveRecording, type Recording } from '../storage/recordings';

const clock = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

const dateFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' });

function Take({ rec, onDelete, onReamp }: { rec: Recording; onDelete: () => void; onReamp?: () => Promise<void> }) {
  const [working, setWorking] = useState(false);
  const url = useMemo(() => URL.createObjectURL(rec.blob), [rec.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const mb = rec.blob.size / 1024 / 1024;
  return (
    <li className="take">
      <div className="take-info">
        <strong>{rec.name}</strong>
        <span>
          {dateFmt.format(rec.createdAt)}, {clock(rec.duration)}, {rec.sampleRate / 1000} kHz{' '}
          {rec.channels === 1 ? 'mono' : 'estéreo'}, {rec.source === 'wet' ? 'mezcla' : 'en seco'}, {mb.toFixed(1)} MB
        </span>
      </div>
      <audio controls preload="none" src={url} />
      <div className="take-actions">
        <a className="btn ghost" href={url} download={`${rec.name}.wav`}>
          Descargar WAV
        </a>
        {onReamp && (rec.source === 'dry' || !rec.source) && (
          <button
            className="btn ghost"
            disabled={working}
            title="Procesa esta toma en seco con la pedalera actual y crea una toma nueva"
            onClick={async () => {
              setWorking(true);
              try {
                await onReamp();
              } finally {
                setWorking(false);
              }
            }}
          >
            {working ? 'Procesando…' : 'Re-amp'}
          </button>
        )}
        <button className="btn ghost danger" onClick={onDelete}>
          Borrar
        </button>
      </div>
    </li>
  );
}

interface RecorderProps {
  engine: AudioEngine;
  /** Cambia cuando otra parte de la app guarda una toma: recarga la lista */
  version: number;
  onReamp: (rec: Recording) => Promise<Recording>;
  /** Otra sección (el multipista) está usando la grabación */
  blocked: boolean;
  register: Register;
  source: RecordSource;
  onSource: (s: RecordSource) => void;
  onRecordingChange: (on: boolean) => void;
}

export function Recorder({ engine, version, onReamp, blocked, register, source, onSource, onRecordingChange }: RecorderProps) {
  const [takes, setTakes] = useState<Recording[]>([]);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    listRecordings().then(setTakes).catch(() => setError('No se pueden leer las grabaciones guardadas en este navegador.'));
  }, [version]);

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setElapsed((performance.now() - startedAt.current) / 1000), 250);
    return () => window.clearInterval(id);
  }, [recording]);

  const start = () => {
    setError(null);
    engine.startRecording();
    startedAt.current = performance.now();
    setElapsed(0);
    setRecording(true);
    onRecordingChange(true);
  };

  const stop = async () => {
    setRecording(false);
    setSaving(true);
    try {
      const { channels, sampleRate } = await engine.stopRecording();
      const frames = channels[0]?.length ?? 0;
      if (frames === 0) throw new Error('empty');
      const rec: Recording = {
        id: crypto.randomUUID(),
        name: `Toma ${takes.length + 1}`,
        createdAt: Date.now(),
        duration: frames / sampleRate,
        sampleRate,
        channels: channels.length,
        source,
        blob: encodeWav(channels, sampleRate)
      };
      await saveRecording(rec);
      navigator.storage?.persist?.().catch(() => undefined);
      setTakes((t) => [rec, ...t]);
    } catch (e) {
      setError(
        e instanceof Error && e.message === 'empty'
          ? 'La toma está vacía. Comprueba que el medidor de nivel se mueve antes de grabar.'
          : 'No se ha podido guardar la toma. Puede que el navegador no tenga espacio disponible.'
      );
    } finally {
      setSaving(false);
      onRecordingChange(false);
    }
  };

  useAction(register, 'recorder.toggle', () => {
    if (recording) {
      stop();
      return 'Grabación detenida';
    }
    if (saving || blocked) return 'No se puede grabar ahora';
    start();
    return 'Grabando';
  });

  const remove = async (id: string) => {
    await deleteRecording(id);
    setTakes((t) => t.filter((r) => r.id !== id));
  };

  return (
    <section className="panel recorder" aria-labelledby="rec-title">
      <div className="panel-head">
        <h2 id="rec-title">Grabación</h2>
        <span className="hint">WAV de 24 bits. Mezcla graba todo lo que suena (guitarra con efectos, looper y ritmo); En seco, solo la guitarra limpia.</span>
      </div>

      <div className="transport">
        <button
          className={`rec-button${recording ? ' is-recording' : ''}`}
          onClick={recording ? stop : start}
          disabled={saving || (blocked && !recording)}
          aria-pressed={recording}
        >
          <span className="rec-dot" aria-hidden="true" />
          {recording ? 'Detener' : saving ? 'Guardando…' : 'Grabar'}
        </button>
        <span className="rec-time" aria-live="off">
          {clock(elapsed)}
        </span>
        <div className="segmented rec-source" role="group" aria-label="Señal que se graba">
          <button aria-pressed={source === 'wet'} onClick={() => onSource('wet')} disabled={recording || saving}>
            Mezcla
          </button>
          <button aria-pressed={source === 'dry'} onClick={() => onSource('dry')} disabled={recording || saving}>
            En seco
          </button>
        </div>
      </div>

      {error && <p className="notice error">{error}</p>}

      {takes.length === 0 ? (
        <p className="empty">Tus tomas aparecerán aquí. Se guardan solo en este navegador y puedes descargarlas en WAV.</p>
      ) : (
        <ul className="takes">
          {takes.map((t) => (
            <Take
              key={t.id}
              rec={t}
              onDelete={() => remove(t.id)}
              onReamp={async () => {
                const created = await onReamp(t);
                setTakes((list) => [created, ...list]);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
