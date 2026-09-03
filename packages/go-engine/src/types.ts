export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type Color = typeof BLACK | typeof WHITE;
export type Stone = typeof EMPTY | Color;

export function opponent(color: Color): Color {
  return color === BLACK ? WHITE : BLACK;
}

export type Move =
  | { type: 'play'; x: number; y: number }
  | { type: 'pass' }
  | { type: 'resign' };

export type IllegalReason =
  | 'off-board'
  | 'occupied'
  | 'suicide'
  | 'ko'
  | 'superko'
  | 'not-playing';

export type Result<T> = { ok: true; value: T } | { ok: false; reason: IllegalReason };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(reason: IllegalReason): Result<T> {
  return { ok: false, reason };
}

/**
 * Ко по умолчанию — позиционный суперко: запрещено воспроизводить любую
 * встречавшуюся ранее позицию. Простое ко оставлено опцией для импорта чужих партий.
 */
export interface Rules {
  ko: 'simple' | 'positional-superko';
  suicide: 'forbidden' | 'allowed';
}

export const DEFAULT_RULES: Rules = {
  ko: 'positional-superko',
  suicide: 'forbidden',
};

export type Phase = 'playing' | 'scoring' | 'finished';
