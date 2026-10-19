import { useEffect, useState } from 'react';
import type { BoardState, PedalState } from '../audio/chain';
import { DEF_BY_TYPE, type EffectType } from '../audio/effects';
import { Knob } from './Knob';

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
  onKeyMove
}: {
  pedal: PedalState;
  index: number;
  dragging: boolean;
  onUpdate: (p: PedalState) => void;
  onDragStart: (e: React.PointerEvent) => void;
  onKeyMove: (dir: -1 | 1) => void;
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
          p.choices ? (
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

export function Pedalboard({ board, onChange }: { board: BoardState; onChange: (b: BoardState) => void }) {
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
      {board.map((pedal, i) => (
        <Pedal
          key={pedal.type}
          pedal={pedal}
          index={i}
          dragging={dragging === pedal.type}
          onUpdate={(p) => onChange(board.map((x) => (x.type === p.type ? p : x)))}
          onDragStart={(e) => {
            e.preventDefault();
            setDragging(pedal.type);
          }}
          onKeyMove={(dir) => onChange(move(board, pedal.type, i + dir))}
        />
      ))}
    </div>
  );
}
