import { createEffect, DEF_BY_TYPE, EFFECT_DEFS, type Effect, type EffectType } from './effects';

export interface PedalState {
  type: EffectType;
  enabled: boolean;
  params: Record<string, number>;
}

/** Orden de la pedalera de izquierda a derecha, con el estado de cada pedal. */
export type BoardState = PedalState[];

export const DEFAULT_ORDER: EffectType[] = EFFECT_DEFS.map((d) => d.type);

export function defaultPedal(type: EffectType): PedalState {
  const def = DEF_BY_TYPE[type];
  return { type, enabled: false, params: Object.fromEntries(def.params.map((p) => [p.key, p.default])) };
}

export const defaultBoard = (): BoardState => DEFAULT_ORDER.map(defaultPedal);

/** Acepta cualquier cosa (p. ej. un JSON importado) y devuelve una pedalera válida y completa. */
export function normalizeBoard(input: unknown): BoardState {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set<EffectType>();
  const out: BoardState = [];
  for (const item of list) {
    const type = (item as PedalState)?.type;
    if (!type || !(type in DEF_BY_TYPE) || seen.has(type)) continue;
    seen.add(type);
    const base = defaultPedal(type);
    const params = { ...base.params };
    for (const p of DEF_BY_TYPE[type].params) {
      const v = Number((item as PedalState).params?.[p.key]);
      if (Number.isFinite(v)) params[p.key] = Math.max(p.min, Math.min(p.max, v));
    }
    out.push({ type, enabled: Boolean((item as PedalState).enabled), params });
  }
  for (const type of DEFAULT_ORDER) if (!seen.has(type)) out.push(defaultPedal(type));
  return out;
}

/** Cadena de efectos: solo toca el grafo de audio en lo que cambia respecto al último estado. */
export class EffectChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private effects = new Map<EffectType, Effect>();
  private order: EffectType[] = [];
  private applied = new Map<EffectType, PedalState>();

  constructor(ctx: AudioContext) {
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);
    for (const type of DEFAULT_ORDER) this.effects.set(type, createEffect(ctx, type));
    this.wire(DEFAULT_ORDER);
  }

  private wire(order: EffectType[]) {
    this.input.disconnect();
    for (const e of this.effects.values()) e.output.disconnect();
    let prev: AudioNode = this.input;
    for (const type of order) {
      const e = this.effects.get(type)!;
      prev.connect(e.input);
      prev = e.output;
    }
    prev.connect(this.output);
    this.order = order;
  }

  apply(board: BoardState) {
    const order = board.map((p) => p.type);
    if (order.join() !== this.order.join()) this.wire(order);
    for (const pedal of board) {
      const effect = this.effects.get(pedal.type)!;
      const last = this.applied.get(pedal.type);
      for (const [key, value] of Object.entries(pedal.params)) {
        if (last?.params[key] !== value) effect.setParam(key, value);
      }
      if (last?.enabled !== pedal.enabled) effect.setEnabled(pedal.enabled);
      this.applied.set(pedal.type, { ...pedal, params: { ...pedal.params } });
    }
  }
}
