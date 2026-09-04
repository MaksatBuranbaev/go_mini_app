import type { TimeControl } from '@go/protocol';

/**
 * Готовые контроли времени вместо полного редактора: в лобби для друзей
 * важнее сделать выбор в один тап, чем задать любые мыслимые настройки.
 *
 * Лестница своя для каждой доски. Те же «2 мин + 7 сек» — это быстрая партия
 * на 9×9 и полтора часа на 19×19, потому что ходов там вчетверо больше.
 * Ступени подписаны не самим контролем, а тем, сколько партия займёт: выбирают
 * ведь свободный вечер, а не миллисекунды.
 */
const LADDER: Record<number, TimeControl[][]> = {
  9: [
    [fischer(30, 5), byoyomi(30, 10)],
    [fischer(120, 7), byoyomi(120, 15)],
    [fischer(300, 10), byoyomi(300, 20)],
  ],
  13: [
    [fischer(30, 5), byoyomi(30, 10)],
    [fischer(180, 7), byoyomi(180, 15)],
    [fischer(300, 10), byoyomi(300, 20)],
  ],
  19: [
    [fischer(30, 5), byoyomi(30, 10)],
    [fischer(300, 7), byoyomi(300, 15)],
    [fischer(600, 10), byoyomi(600, 20)],
  ],
};

/** Ступень лестницы: подпись длительности и варианты одной длины. */
export interface TimeTier {
  label: string;
  options: TimeControl[];
}

/** Ступень по умолчанию — средняя: обычная партия, а не блиц и не вечер. */
export const DEFAULT_TIER = 1;

export function timeTiers(size: number): TimeTier[] {
  const ladder = LADDER[size] ?? LADDER[13]!;
  return [
    ...ladder.map((options) => ({ label: `~ ${minutesText(tierMinutes(options, size))}`, options })),
    { label: 'Сколько понадобится', options: [{ type: 'none' } as TimeControl] },
  ];
}

/** «30 сек + 5 сек», «10 мин + 5×30 сек», «без часов». */
export function controlText(time: TimeControl): string {
  switch (time.type) {
    case 'none':
      return 'Без часов';
    case 'fischer':
      return `${timeText(time.mainMs)} + ${timeText(time.incrementMs)}`;
    case 'byoyomi':
      return `${timeText(time.mainMs)} + ${time.periods}×${timeText(time.periodMs)}`;
  }
}

/**
 * Сколько ходов делает один игрок на доске такого размера. Числа взяты из
 * длины обычной партии до двух пасов: 9×9 — полсотни ходов на двоих,
 * 19×19 — за две сотни.
 */
const MOVES_PER_PLAYER: Record<number, number> = { 9: 25, 13: 55, 19: 110 };

/**
 * Период бёёми целиком досиживают редко, поэтому в оценку он входит долей.
 * Иначе выходит верхняя граница, до которой партии не доходят, и подпись
 * пугает вместо того, чтобы помогать.
 */
const BYOYOMI_SHARE = 0.6;

/** Сколько минут займёт партия с таким контролем на такой доске. */
export function lengthMinutes(time: TimeControl, size: number): number {
  if (time.type === 'none') return 0;

  const moves = MOVES_PER_PLAYER[size] ?? 60;
  const perPlayer =
    time.type === 'fischer'
      ? time.mainMs + time.incrementMs * moves
      : time.mainMs + time.periodMs * BYOYOMI_SHARE * moves;

  return (perPlayer * 2) / 60_000;
}

/** Подпись ступени: одно круглое число на оба варианта, они близки по длине. */
function tierMinutes(options: TimeControl[], size: number): number {
  const total = options.reduce((sum, option) => sum + lengthMinutes(option, size), 0);
  return roundish(total / options.length);
}

/** Оценка и так приблизительная — незачем показывать «27 мин». */
function roundish(minutes: number): number {
  if (minutes <= 30) return Math.round(minutes / 5) * 5;
  if (minutes <= 45) return Math.round(minutes / 10) * 10;
  return Math.round(minutes / 15) * 15;
}

function minutesText(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} ч ${rest} мин` : `${Math.floor(minutes / 60)} ч`;
}

function timeText(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds >= 60 ? `${Math.round(seconds / 60)} мин` : `${seconds} сек`;
}

function fischer(mainSeconds: number, incrementSeconds: number): TimeControl {
  return { type: 'fischer', mainMs: mainSeconds * 1000, incrementMs: incrementSeconds * 1000 };
}

/** Пять периодов: столько прощает большинство серверов, к этому и привыкли. */
function byoyomi(mainSeconds: number, periodSeconds: number): TimeControl {
  return { type: 'byoyomi', mainMs: mainSeconds * 1000, periodMs: periodSeconds * 1000, periods: 5 };
}
