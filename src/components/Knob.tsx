import { useRef } from 'react';
import type { ParamDef } from '../audio/effects';

const SWEEP = 135;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

const toNorm = (d: ParamDef, v: number) =>
  d.log ? Math.log(v / d.min) / Math.log(d.max / d.min) : (v - d.min) / (d.max - d.min);

function fromNorm(d: ParamDef, n: number) {
  const raw = d.log ? d.min * (d.max / d.min) ** clamp(n) : d.min + clamp(n) * (d.max - d.min);
  const stepped = Math.round(raw / d.step) * d.step;
  return Number(Math.max(d.min, Math.min(d.max, stepped)).toFixed(4));
}

export function formatValue(d: ParamDef, v: number): string {
  switch (d.unit) {
    case 'dB':
      return `${v > 0 ? '+' : ''}${v.toFixed(d.step < 1 ? 1 : 0)} dB`;
    case 'ms':
      return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
    case 's':
      return `${v.toFixed(1)} s`;
    case 'Hz':
      return `${v.toFixed(2)} Hz`;
    case ':1':
      return `${v}:1`;
    case '%':
      return `${Math.round(v)} %`;
    default:
      return String(v);
  }
}

function arc(r: number, from: number, to: number) {
  const pt = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${28 + r * Math.cos(a)} ${28 + r * Math.sin(a)}`;
  };
  const large = to - from > 180 ? 1 : 0;
  return `M ${pt(from)} A ${r} ${r} 0 ${large} 1 ${pt(to)}`;
}

export function Knob({ def, value, onChange }: { def: ParamDef; value: number; onChange: (v: number) => void }) {
  const drag = useRef<{ y: number; n: number } | null>(null);
  const norm = clamp(toNorm(def, value));
  const angle = -SWEEP + norm * SWEEP * 2;

  const nudge = (dn: number) => {
    let next = fromNorm(def, norm + dn);
    if (next === value) next = Math.max(def.min, Math.min(def.max, value + Math.sign(dn) * def.step));
    onChange(next);
  };

  return (
    <div className="knob">
      <div
        className="knob-dial"
        role="slider"
        tabIndex={0}
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-valuenow={value}
        aria-valuetext={formatValue(def, value)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, n: norm };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const sensitivity = e.shiftKey ? 600 : 160;
          onChange(fromNorm(def, drag.current.n + (drag.current.y - e.clientY) / sensitivity));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => onChange(def.default)}
        onKeyDown={(e) => {
          const map: Record<string, number> = { ArrowUp: 0.01, ArrowRight: 0.01, ArrowDown: -0.01, ArrowLeft: -0.01, PageUp: 0.1, PageDown: -0.1 };
          if (e.key in map) {
            e.preventDefault();
            nudge(map[e.key]);
          } else if (e.key === 'Home') onChange(def.min);
          else if (e.key === 'End') onChange(def.max);
        }}
        title="Arrastra arriba o abajo. Doble clic para el valor por defecto."
      >
        <svg viewBox="0 0 56 56" aria-hidden="true">
          <path d={arc(23, -SWEEP, SWEEP)} className="knob-track" />
          {norm > 0.003 && <path d={arc(23, -SWEEP, angle)} className="knob-value" />}
          <circle cx="28" cy="28" r="16" className="knob-cap" />
          <line x1="28" y1="28" x2="28" y2="15" className="knob-pointer" transform={`rotate(${angle} 28 28)`} />
        </svg>
      </div>
      <span className="knob-label">{def.label}</span>
      <span className="knob-readout">{formatValue(def, value)}</span>
    </div>
  );
}
