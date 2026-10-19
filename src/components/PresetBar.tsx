import { useRef, useState } from 'react';
import type { Preset } from '../presets';

interface Props {
  factory: Preset[];
  user: Preset[];
  current: Preset | undefined;
  modified: boolean;
  onLoad: (id: string) => void;
  onSave: () => void;
  onSaveAs: (name: string) => void;
  onDelete: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

export function PresetBar({ factory, user, current, modified, onLoad, onSave, onSaveAs, onDelete, onExport, onImport }: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const isUser = current && !current.factory;

  const startNaming = () => {
    setName(current && modified ? `${current.name} (copia)` : '');
    setNaming(true);
  };

  const confirmName = () => {
    const n = name.trim();
    if (!n) return;
    onSaveAs(n.slice(0, 60));
    setNaming(false);
  };

  return (
    <div className="presets">
      <label className="preset-select">
        <span className="visually-hidden">Preset</span>
        <select value={current?.id ?? ''} onChange={(e) => onLoad(e.target.value)}>
          {!current && <option value="">Sin guardar</option>}
          <optgroup label="De fábrica">
            {factory.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
          {user.length > 0 && (
            <optgroup label="Mis presets">
              {user.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {modified && <span className="preset-dirty">Cambios sin guardar</span>}

      {naming ? (
        <span className="preset-naming">
          <input
            autoFocus
            value={name}
            placeholder="Nombre del preset"
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmName();
              if (e.key === 'Escape') setNaming(false);
            }}
            aria-label="Nombre del preset"
          />
          <button className="btn primary-soft" onClick={confirmName} disabled={!name.trim()}>
            Guardar
          </button>
          <button className="btn ghost" onClick={() => setNaming(false)}>
            Cancelar
          </button>
        </span>
      ) : (
        <span className="preset-actions">
          {isUser && (
            <button className="btn" onClick={onSave} disabled={!modified}>
              Guardar
            </button>
          )}
          <button className="btn" onClick={startNaming}>
            Guardar como…
          </button>
          {isUser && (
            <button className="btn ghost danger" onClick={onDelete}>
              Borrar
            </button>
          )}
          <button className="btn ghost" onClick={onExport}>
            Exportar
          </button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            Importar
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
        </span>
      )}
    </div>
  );
}
