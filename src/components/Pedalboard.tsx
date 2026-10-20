import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BoardState, PedalState } from '../audio/chain';
import { DEF_BY_TYPE, type EffectType } from '../audio/effects';
import type { StoredIr } from '../storage/irs';
import { Knob } from './Knob';

export interface IrActions {
  irs: StoredIr[];
  onUploadIr: (file: File) => void;
  onDeleteIr: (id: string) => void;
}

function CabIr({ pedal, onUpdate, irs, onUploadIr, onDeleteIr }: IrActions & { pedal: PedalState; onUpdate: (p: PedalState) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  if (pedal.params.model !== 3) return null;
  const selected = irs.find((i) => i.id === pedal.ir);
  const missing = Boolean(pedal.ir) && !selected;

  return (
    <div className="cab-ir">
      {irs.length > 0 ? (
        <select
          aria-label="IR propia"
          value={selected?.id ?? ''}
          onChange={(e) => onUpdate({ ...pedal, ir: e.target.value || undefined })}
        >
          <option value="">Elige una IR</option>
          {irs.map((ir) => (
            <option key={ir.id} value={ir.id}>
              {ir.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="hint">Carga un archivo WAV con la respuesta al impulso (IR) de un altavoz.</p>
      )}
      {!selected && (
        <p className="hint warn">
          {missing ? 'La IR de este preset no está en este navegador.' : 'Todavía no hay IR elegida.'} Mientras tanto suena la
          4x12.
        </p>
      )}
      <div className="cab-ir-actions">
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Cargar IR…
        </button>
        {selected && (
          <button className="btn ghost danger" onClick={() => onDeleteIr(selected.id)}>
            Borrar IR
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="audio/wav,audio/x-wav,.wav"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUploadIr(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function move(board: BoardState, type: EffectType, to: number): BoardState {
  const from = board.findIndex((p) => p.type === type);
  if (from < 0 || to < 0 || to >= board.length || from === to) return board;
  const next = [...board];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function Pedal({
  pedal,
  index,
  dragging,
  onUpdate,
  onDragStart,
  onKeyMove,
  extra
}: {
  pedal: PedalState;
  index: number;
  dragging: boolean;
  onUpdate: (p: PedalState) => void;
  onDragStart: (e: React.PointerEvent) => void;
  onKeyMove: (dir: -1 | 1) => void;
  extra?: ReactNode;
}) {
  const def = DEF_BY_TYPE[pedal.type];
  const setParam = (key: string, v: number) => onUpdate({ ...pedal, params: { ...pedal.params, [key]: v } });

  return (
    <article
      className={`pedal${pedal.enabled ? ' on' : ''}${dragging ? ' dragging' : ''}`}
      data-pedal={pedal.type}
      aria-label={`${def.name}, posición ${index + 1}`}
    >
      <header className="pedal-head">
        <button
          className="pedal-handle"
          onPointerDown={onDragStart}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault();
              onKeyMove(-1);
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault();
              onKeyMove(1);
            }
          }}
          aria-label={`Mover ${def.name}. Arrastra o usa las flechas.`}
          title="Arrastra para cambiar el orden"
        >
          <span className="pedal-pos">{index + 1}</span>
        </button>
        <h3>{def.name}</h3>
      </header>

      <div className="pedal-controls">
        {def.params.map((p) =>
          // El micrófono solo aplica a las pantallas de fábrica, no a una IR propia
          pedal.type === 'cab' && p.key === 'mic' && pedal.params.model === 3 ? null : p.choices ? (
            <div key={p.key} className="pedal-choice segmented small" role="group" aria-label={p.label}>
              {p.choices.map((c) => (
                <button key={c.value} aria-pressed={pedal.params[p.key] === c.value} onClick={() => setParam(p.key, c.value)}>
                  {c.label}
                </button>
              ))}
            </div>
          ) : (
            <Knob key={p.key} def={p} value={pedal.params[p.key]} onChange={(v) => setParam(p.key, v)} />
          )
        )}
      </div>

      {extra}

      <button
        className="footswitch"
        role="switch"
        aria-checked={pedal.enabled}
        aria-label={`${def.name} ${pedal.enabled ? 'activado' : 'desactivado'}`}
        onClick={() => onUpdate({ ...pedal, enabled: !pedal.enabled })}
      >
        <span className="lamp" aria-hidden="true" />
        {pedal.enabled ? 'Activado' : 'Apagado'}
      </button>
    </article>
  );
}

function GateAuto({ onAutoGate }: { onAutoGate: () => Promise<number> }) {
  const [state, setState] = useState<'idle' | 'measuring' | number>('idle');
  return (
    <div className="gate-auto">
      <button
        className="btn"
        disabled={state === 'measuring'}
        onClick={async () => {
          setState('measuring');
          setState(await onAutoGate());
        }}
      >
        {state === 'measuring' ? 'Escuchando el ruido…' : 'Ajustar automáticamente'}
      </button>
      <p className="hint">
        {state === 'measuring'
          ? 'No toques las cuerdas durante 2 segundos.'
          : typeof state === 'number'
            ? `Umbral ajustado a ${state} dB.`
            : 'Mide el ruido de fondo con la guitarra en silencio y fija el umbral justo por encima.'}
      </p>
    </div>
  );
}

interface PedalboardProps {
  board: BoardState;
  onChange: (b: BoardState) => void;
  ir: IrActions;
  onAutoGate: () => Promise<number>;
}

export function Pedalboard({ board, onChange, ir, onAutoGate }: PedalboardProps) {
  const [dragging, setDragging] = useState<EffectType | null>(null);

  // Al reordenar, el navegador puede perder la captura del puntero: el fin del arrastre se escucha en la ventana
  useEffect(() => {
    if (!dragging) return;
    const end = () => setDragging(null);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dragging]);

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-pedal]');
    const type = over?.dataset.pedal as EffectType | undefined;
    if (type && type !== dragging) onChange(move(board, dragging, board.findIndex((p) => p.type === type)));
  };

  return (
    <div className={`pedals${dragging ? ' is-dragging' : ''}`} onPointerMove={onPointerMove}>
      {board.map((pedal, i) => {
        const update = (p: PedalState) => onChange(board.map((x) => (x.type === p.type ? p : x)));
        return (
        <Pedal
          key={pedal.type}
          pedal={pedal}
          index={i}
          dragging={dragging === pedal.type}
          onUpdate={update}
          extra={
            pedal.type === 'cab' ? (
              <CabIr pedal={pedal} onUpdate={update} {...ir} />
            ) : pedal.type === 'gate' ? (
              <GateAuto onAutoGate={onAutoGate} />
            ) : undefined
          }
          onDragStart={(e) => {
            e.preventDefault();
            setDragging(pedal.type);
          }}
          onKeyMove={(dir) => onChange(move(board, pedal.type, i + dir))}
        />
        );
      })}
    </div>
  );
}
