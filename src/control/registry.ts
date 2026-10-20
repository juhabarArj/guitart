import { useEffect, useRef } from 'react';
import type { ActionId } from './actions';

/** El manejador puede devolver el texto del aviso que se muestra al dispararse. */
export type ActionHandler = () => string | void;
export type Register = (id: ActionId, fn: ActionHandler) => () => void;

/** Registra el manejador de una acción mientras el componente está montado (siempre con su versión más reciente). */
export function useAction(register: Register, id: ActionId, fn: ActionHandler) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => register(id, () => ref.current()), [register, id]);
}
