// Acciones que se pueden disparar con teclado, MIDI o pedal Bluetooth, desde cualquier pestaña.

export type ActionId =
  | 'looper.main'
  | 'looper.stop'
  | 'looper.undo'
  | 'rhythm.toggle'
  | 'rhythm.tap'
  | 'recorder.toggle'
  | 'studio.play'
  | 'studio.record'
  | 'preset.next'
  | 'preset.prev'
  | 'tuner.mute'
  | 'song.play'
  | 'song.toA'
  | 'song.loop'
  | `pedal.${number}`;

export interface ActionDef {
  id: ActionId;
  label: string;
  group: string;
}

export const ACTIONS: ActionDef[] = [
  { id: 'looper.main', label: 'Botón principal (grabar, cerrar, añadir capa)', group: 'Looper' },
  { id: 'looper.stop', label: 'Parar o reproducir el bucle', group: 'Looper' },
  { id: 'looper.undo', label: 'Deshacer la última capa', group: 'Looper' },
  { id: 'rhythm.toggle', label: 'Iniciar o parar el ritmo', group: 'Ritmo' },
  { id: 'rhythm.tap', label: 'Marcar el tempo', group: 'Ritmo' },
  { id: 'recorder.toggle', label: 'Grabar o detener (Grabación)', group: 'Grabación' },
  { id: 'studio.play', label: 'Reproducir o parar el multipista', group: 'Estudio' },
  { id: 'studio.record', label: 'Grabar en la pista marcada', group: 'Estudio' },
  { id: 'preset.next', label: 'Preset siguiente', group: 'Pedalera' },
  { id: 'preset.prev', label: 'Preset anterior', group: 'Pedalera' },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `pedal.${i + 1}` as ActionId,
    label: `Activar o apagar el pedal ${i + 1}`,
    group: 'Pedalera'
  })),
  { id: 'tuner.mute', label: 'Silenciar al afinar', group: 'Afinador' },
  { id: 'song.play', label: 'Reproducir o pausar la canción', group: 'Canciones' },
  { id: 'song.toA', label: 'Volver al inicio del bucle (o de la canción)', group: 'Canciones' },
  { id: 'song.loop', label: 'Activar o quitar el bucle A-B', group: 'Canciones' }
];

/** Asignaciones: "key:<código de tecla>" o "midi:cc:64", "midi:note:60", "midi:pc:3" */
export type Bindings = Partial<Record<ActionId, string[]>>;

export const DEFAULT_BINDINGS: Bindings = {
  'looper.main': ['key:Space'],
  'looper.stop': ['key:Escape'],
  'looper.undo': ['key:Backspace'],
  'rhythm.toggle': ['key:KeyM'],
  'recorder.toggle': ['key:KeyR'],
  'preset.next': ['key:ArrowRight', 'key:PageDown'],
  'preset.prev': ['key:ArrowLeft', 'key:PageUp'],
  'tuner.mute': ['key:KeyT'],
  'song.play': ['key:KeyP'],
  'song.toA': ['key:KeyB'],
  'song.loop': ['key:KeyL'],
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`pedal.${i + 1}`, [`key:Digit${i + 1}`]]))
};

const KEY_NAMES: Record<string, string> = {
  Space: 'Espacio',
  Escape: 'Esc',
  Backspace: 'Retroceso',
  Enter: 'Intro',
  Tab: 'Tab',
  ArrowRight: '→',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PageDown: 'Av Pág',
  PageUp: 'Re Pág',
  Home: 'Inicio',
  End: 'Fin'
};

export function bindingLabel(b: string): string {
  const [kind, a, n] = b.split(':');
  if (kind === 'key') {
    if (KEY_NAMES[a]) return KEY_NAMES[a];
    if (a.startsWith('Key')) return a.slice(3);
    if (a.startsWith('Digit')) return a.slice(5);
    if (a.startsWith('Numpad')) return `Num ${a.slice(6)}`;
    return a;
  }
  if (a === 'cc') return `MIDI CC ${n}`;
  if (a === 'note') return `MIDI nota ${n}`;
  if (a === 'pc') return `MIDI programa ${Number(n) + 1}`;
  return b;
}
