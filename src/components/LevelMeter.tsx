import { useEffect, useRef } from 'react';
import type { AudioEngine } from '../audio/engine';

const FLOOR = -60;
const pct = (db: number) => Math.max(0, Math.min(1, (db - FLOOR) / -FLOOR)) * 100;
const MARKS = [-48, -36, -24, -12, -6, 0];

export function LevelMeter({ engine, active }: { engine: AudioEngine; active: boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let hold = -Infinity;
    let holdAt = 0;
    let clipAt = -Infinity;
    let lastText = 0;
    const tick = (t: number) => {
      const { peakDb, rmsDb } = engine.readLevel();
      if (peakDb >= hold || t - holdAt > 1200) {
        hold = peakDb;
        holdAt = t;
      }
      if (peakDb > -0.5) clipAt = t;
      const el = bar.current;
      if (el) {
        el.style.setProperty('--rms', `${pct(rmsDb)}%`);
        el.style.setProperty('--peak', `${pct(peakDb)}%`);
        el.style.setProperty('--hold', `${pct(hold)}%`);
        el.dataset.clip = t - clipAt < 1500 ? 'on' : 'off';
      }
      if (readout.current && t - lastText > 150) {
        readout.current.textContent = Number.isFinite(hold) ? `${hold.toFixed(1)} dB` : 'Sin señal';
        lastText = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, active]);

  return (
    <div className="meter">
      <div className="meter-head">
        <span>Nivel de entrada</span>
        <span className="meter-readout" ref={readout}>Sin señal</span>
      </div>
      <div className="meter-bar" ref={bar} role="img" aria-label="Medidor de nivel de entrada">
        <div className="meter-peak" />
        <div className="meter-rms" />
        <div className="meter-hold" />
        <span className="meter-clip" title="Saturación: baja la ganancia" />
      </div>
      <div className="meter-scale" aria-hidden="true">
        {MARKS.map((m) => (
          <span key={m} style={{ left: `${pct(m)}%` }}>
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}
