import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { noteFromFreq, STANDARD_TUNING, type NoteReading } from '../audio/pitch';

const W = 320;
const CX = W / 2;
const CY = 178;
const R = 140;
const SWEEP = 58; // grados a cada lado para ±50 cents

const polar = (deg: number, r: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
};

const TICKS = Array.from({ length: 21 }, (_, i) => -50 + i * 5);

export function Tuner({ engine, a4, onA4 }: { engine: AudioEngine; a4: number; onA4: (v: number) => void }) {
  const [reading, setReading] = useState<NoteReading | null>(null);
  const history = useRef<number[]>([]);
  const lastSeen = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      const f = engine.readPitch();
      const now = performance.now();
      if (f == null) {
        if (now - lastSeen.current > 600) {
          history.current = [];
          setReading(null);
        }
        return;
      }
      lastSeen.current = now;
      const h = history.current;
      h.push(f);
      if (h.length > 5) h.shift();
      const median = [...h].sort((a, b) => a - b)[h.length >> 1];
      setReading(noteFromFreq(median, a4));
    }, 60);
    return () => window.clearInterval(id);
  }, [engine, a4]);

  const cents = reading ? Math.max(-50, Math.min(50, reading.cents)) : 0;
  const inTune = reading != null && Math.abs(reading.cents) < 5;
  const state = !reading ? 'idle' : inTune ? 'tuned' : reading.cents < 0 ? 'flat' : 'sharp';
  const angle = (cents / 50) * SWEEP;

  return (
    <section className="panel tuner" data-state={state} aria-labelledby="tuner-title">
      <div className="panel-head">
        <h2 id="tuner-title">Afinador</h2>
        <label className="a4">
          La
          <input
            type="number"
            min={430}
            max={450}
            value={a4}
            onChange={(e) => onA4(Math.max(430, Math.min(450, Number(e.target.value) || 440)))}
            aria-label="Frecuencia de referencia del La en hercios"
          />
          Hz
        </label>
      </div>

      <svg className="gauge" viewBox={`0 0 ${W} 196`} aria-hidden="true">
        {TICKS.map((c) => {
          const deg = (c / 50) * SWEEP;
          const major = c % 25 === 0;
          const [x1, y1] = polar(deg, R);
          const [x2, y2] = polar(deg, R - (major ? 22 : c % 10 === 0 ? 14 : 9));
          return <line key={c} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? 'tick major' : 'tick'} />;
        })}
        <path
          className="zone"
          d={`M ${polar(-SWEEP / 10, R + 8).join(' ')} A ${R + 8} ${R + 8} 0 0 1 ${polar(SWEEP / 10, R + 8).join(' ')}`}
        />
        <text x={polar(-SWEEP, R + 20)[0]} y={polar(-SWEEP, R + 20)[1]} className="gauge-label">
          ♭
        </text>
        <text x={polar(SWEEP, R + 20)[0]} y={polar(SWEEP, R + 20)[1]} className="gauge-label">
          ♯
        </text>
        <line
          x1={CX}
          y1={CY}
          x2={CX}
          y2={CY - R + 14}
          className="needle"
          style={{ transformOrigin: `${CX}px ${CY}px`, transform: `rotate(${angle}deg)` }}
        />
        <circle cx={CX} cy={CY} r={7} className="hub" />
      </svg>

      <div className="note" aria-live="polite">
        <span className="note-name">{reading ? reading.latin : '–'}</span>
        <span className="note-sub">
          {reading ? (
            <>
              {reading.letter}
              {reading.octave}
              <span className="note-cents">
                {reading.cents >= 0 ? '+' : '−'}
                {Math.abs(reading.cents).toFixed(0)} cents
              </span>
              <span className="note-freq">{reading.freq.toFixed(1)} Hz</span>
            </>
          ) : (
            'Toca una cuerda'
          )}
        </span>
      </div>

      <ol className="strings" aria-label="Afinación estándar">
        {STANDARD_TUNING.map((s, i) => (
          <li key={i} className={reading?.midi === s.midi ? 'active' : undefined}>
            <span>{s.latin}</span>
            <small>{s.letter}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
