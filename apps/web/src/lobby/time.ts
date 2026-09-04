import type { TimeControl } from '@go/protocol';

/**
 * Готовые контроли времени вместо полного редактора: в лобби для друзей
 * важнее сделать выбор в один тап, чем задать любые мыслимые настройки.
 */
export const TIME_PRESETS: TimeControl[] = [
  { type: 'fischer', mainMs: 30_000, incrementMs: 5_000 },
  { type: 'fischer', mainMs: 120_000, incrementMs: 7_000 },
  { type: 'fischer', mainMs: 180_000, incrementMs: 10_000 },
  { type: 'byoyomi', mainMs: 600_000, periodMs: 30_000, periods: 3 },
  { type: 'none' },
];

/**
 * Сколько ходов делает один игрок на доске такого размера. Числа взяты из
 * длины обычной партии до двух пасов: 9×9 — полсотни ходов на двоих,
 * 19×19 — за две сотни.
 */
const MOVES_PER_PLAYER: Record<number, number> = { 9: 25, 13: 55, 19: 110 };

/** «30 сек + 5 сек», «10 мин + 3×30 сек», «без часов». */
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

function timeText(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds >= 60 ? `${Math.round(seconds / 60)} мин` : `${seconds} сек`;
}

/**
 * Сколько примерно продлится партия. Считается, а не подписывается руками:
 * те же «2 мин + 7 сек» на 19×19 — это уже совсем не десять минут.
 */
export function lengthText(time: TimeControl, size: number): string {
  if (time.type === 'none') return 'Сколько понадобится';

  const moves = MOVES_PER_PLAYER[size] ?? 60;
  const perPlayer =
    time.type === 'fischer'
      ? time.mainMs + time.incrementMs * moves
      : time.mainMs + time.periodMs * moves;

  const minutes = Math.round((perPlayer * 2) / 60_000);
  return `~ ${minutes} мин`;
}
