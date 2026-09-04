import type { SeatColor, TimeControl } from '@go/protocol';

/**
 * Состояние часов в хранилище комнаты.
 *
 * `lastMoveAt` — момент, с которого течёт время текущего игрока. `null`
 * означает, что часы стоят: партия ещё не началась, ушла в подсчёт или уже
 * закончена.
 */
export interface ClockState {
  blackMs: number;
  whiteMs: number;
  blackPeriods: number;
  whitePeriods: number;
  lastMoveAt: number | null;
}

export function initialClock(time: TimeControl): ClockState {
  switch (time.type) {
    case 'none':
      return { blackMs: 0, whiteMs: 0, blackPeriods: 0, whitePeriods: 0, lastMoveAt: null };
    case 'fischer':
      return {
        blackMs: time.mainMs,
        whiteMs: time.mainMs,
        blackPeriods: 0,
        whitePeriods: 0,
        lastMoveAt: null,
      };
    case 'byoyomi':
      return {
        blackMs: time.mainMs,
        whiteMs: time.mainMs,
        blackPeriods: time.periods,
        whitePeriods: time.periods,
        lastMoveAt: null,
      };
  }
}

function readSide(clock: ClockState, color: SeatColor): { ms: number; periods: number } {
  return color === 'black'
    ? { ms: clock.blackMs, periods: clock.blackPeriods }
    : { ms: clock.whiteMs, periods: clock.whitePeriods };
}

function writeSide(
  clock: ClockState,
  color: SeatColor,
  side: { ms: number; periods: number },
): ClockState {
  return color === 'black'
    ? { ...clock, blackMs: side.ms, blackPeriods: side.periods }
    : { ...clock, whiteMs: side.ms, whitePeriods: side.periods };
}

/**
 * Сколько игроку осталось до просрочки: основное время плюс все периоды
 * бёёми. Один длинный ход может сжечь их подряд, поэтому дедлайн считается
 * по всей сумме, а не по одному периоду.
 */
export function remainingMs(clock: ClockState, color: SeatColor, time: TimeControl): number {
  if (time.type === 'none') return Number.POSITIVE_INFINITY;
  const side = readSide(clock, color);
  if (time.type === 'fischer') return side.ms;
  return side.ms + side.periods * time.periodMs;
}

/** Момент, в который у текущего игрока кончится время, либо `null` без часов. */
export function deadline(
  clock: ClockState,
  color: SeatColor,
  time: TimeControl,
): number | null {
  if (time.type === 'none' || clock.lastMoveAt === null) return null;
  return clock.lastMoveAt + remainingMs(clock, color, time);
}

export function isExpired(
  clock: ClockState,
  color: SeatColor,
  time: TimeControl,
  now: number,
): boolean {
  const at = deadline(clock, color, time);
  return at !== null && now >= at;
}

/**
 * Списывает потраченное на ход время и запускает часы соперника.
 *
 * Фишер прибавляет инкремент после списания — иначе игрок с нулём на часах
 * успевал бы ходить бесконечно. В бёёми ход, уложившийся в период, периода
 * не тратит: именно это отличает бёёми от простого добавочного времени.
 */
export function afterMove(
  clock: ClockState,
  color: SeatColor,
  time: TimeControl,
  now: number,
): ClockState {
  if (time.type === 'none') return { ...clock, lastMoveAt: now };

  const started = clock.lastMoveAt ?? now;
  const elapsed = Math.max(0, now - started);
  const side = readSide(clock, color);

  if (time.type === 'fischer') {
    const left = Math.max(0, side.ms - elapsed);
    return writeSide({ ...clock, lastMoveAt: now }, color, {
      ms: left + time.incrementMs,
      periods: 0,
    });
  }

  const overflow = elapsed - side.ms;
  if (overflow <= 0) {
    return writeSide({ ...clock, lastMoveAt: now }, color, {
      ms: side.ms - elapsed,
      periods: side.periods,
    });
  }

  // Основное время кончилось. Периоды сгорают только целиком: ход длиной
  // в полтора периода стоит один период, а не полтора.
  const burned = Math.floor(overflow / time.periodMs);
  const periods = Math.max(0, side.periods - burned);
  return writeSide({ ...clock, lastMoveAt: now }, color, { ms: 0, periods });
}

/** Часы останавливаются: подсчёт, сдача, просрочка. */
export function stop(clock: ClockState): ClockState {
  return { ...clock, lastMoveAt: null };
}

/** Возврат к игре из подсчёта — время снова пошло. */
export function resume(clock: ClockState, now: number): ClockState {
  return { ...clock, lastMoveAt: now };
}
