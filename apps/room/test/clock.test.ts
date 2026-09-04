import type { TimeControl } from '@go/protocol';
import { describe, expect, it } from 'vitest';
import {
  afterMove,
  deadline,
  initialClock,
  isExpired,
  remainingMs,
  resume,
  rewindMove,
  stop,
} from '../src/clock.js';

const FISCHER: TimeControl = { type: 'fischer', mainMs: 60_000, incrementMs: 5_000 };
const BYOYOMI: TimeControl = { type: 'byoyomi', mainMs: 30_000, periodMs: 10_000, periods: 3 };
const NONE: TimeControl = { type: 'none' };

describe('часы Фишера', () => {
  it('списывает потраченное и прибавляет инкремент', () => {
    const start = initialClock(FISCHER);
    const running = { ...start, lastMoveAt: 1_000 };

    const after = afterMove(running, 'black', FISCHER, 9_000);

    // Ход занял 8 секунд: 60 − 8 + 5 = 57.
    expect(after.blackMs).toBe(57_000);
    expect(after.whiteMs).toBe(60_000);
    expect(after.lastMoveAt).toBe(9_000);
  });

  it('не уводит остаток в минус и всё равно даёт инкремент', () => {
    const running = { ...initialClock(FISCHER), lastMoveAt: 0 };

    const after = afterMove(running, 'black', FISCHER, 90_000);

    expect(after.blackMs).toBe(5_000);
  });

  it('дедлайн — это остаток от момента начала хода', () => {
    const running = { ...initialClock(FISCHER), lastMoveAt: 1_000 };

    expect(deadline(running, 'black', FISCHER)).toBe(61_000);
    expect(isExpired(running, 'black', FISCHER, 60_999)).toBe(false);
    expect(isExpired(running, 'black', FISCHER, 61_000)).toBe(true);
  });
});

describe('бёёми', () => {
  it('тратит основное время, пока оно есть', () => {
    const running = { ...initialClock(BYOYOMI), lastMoveAt: 0 };

    const after = afterMove(running, 'white', BYOYOMI, 12_000);

    expect(after.whiteMs).toBe(18_000);
    expect(after.whitePeriods).toBe(3);
  });

  it('ход внутри периода периода не тратит', () => {
    const inByoyomi = {
      ...initialClock(BYOYOMI),
      blackMs: 0,
      lastMoveAt: 0,
    };

    const after = afterMove(inByoyomi, 'black', BYOYOMI, 9_500);

    expect(after.blackPeriods).toBe(3);
    expect(after.blackMs).toBe(0);
  });

  it('ход длиной в полтора периода стоит один период, а не полтора', () => {
    const inByoyomi = { ...initialClock(BYOYOMI), blackMs: 0, lastMoveAt: 0 };

    const after = afterMove(inByoyomi, 'black', BYOYOMI, 15_000);

    expect(after.blackPeriods).toBe(2);
  });

  it('длинный ход сжигает несколько периодов подряд', () => {
    const inByoyomi = { ...initialClock(BYOYOMI), blackMs: 0, lastMoveAt: 0 };

    const after = afterMove(inByoyomi, 'black', BYOYOMI, 25_000);

    expect(after.blackPeriods).toBe(1);
  });

  it('переливается из основного времени в периоды одним ходом', () => {
    const running = { ...initialClock(BYOYOMI), lastMoveAt: 0 };

    // 30 с основного плюс 25 с сверху — два периода долой.
    const after = afterMove(running, 'black', BYOYOMI, 55_000);

    expect(after.blackMs).toBe(0);
    expect(after.blackPeriods).toBe(1);
  });

  it('до просрочки считается всё: основное время и все периоды', () => {
    const running = { ...initialClock(BYOYOMI), lastMoveAt: 1_000 };

    expect(remainingMs(running, 'black', BYOYOMI)).toBe(60_000);
    expect(deadline(running, 'black', BYOYOMI)).toBe(61_000);
    expect(isExpired(running, 'black', BYOYOMI, 60_500)).toBe(false);
    expect(isExpired(running, 'black', BYOYOMI, 61_000)).toBe(true);
  });
});

describe('без часов', () => {
  it('не даёт ни дедлайна, ни просрочки', () => {
    const running = { ...initialClock(NONE), lastMoveAt: 1_000 };

    expect(deadline(running, 'black', NONE)).toBeNull();
    expect(isExpired(running, 'black', NONE, 10 ** 12)).toBe(false);
  });
});

describe('остановка и возврат', () => {
  it('на остановленных часах дедлайна нет', () => {
    const stopped = stop({ ...initialClock(FISCHER), lastMoveAt: 5_000 });

    expect(stopped.lastMoveAt).toBeNull();
    expect(deadline(stopped, 'black', FISCHER)).toBeNull();
    expect(isExpired(stopped, 'black', FISCHER, 10 ** 12)).toBe(false);
  });

  it('возврат к игре не съедает время, простоявшее в подсчёте', () => {
    const stopped = stop({ ...initialClock(FISCHER), lastMoveAt: 5_000 });

    const back = resume(stopped, 500_000);

    expect(back.blackMs).toBe(60_000);
    expect(back.lastMoveAt).toBe(500_000);
  });
});

describe('откат хода', () => {
  it('снимает добавку Фишера: отмена не должна копить время', () => {
    const running = { ...initialClock(FISCHER), lastMoveAt: 1_000 };
    const after = afterMove(running, 'black', FISCHER, 9_000);

    const back = rewindMove(after, 'black', FISCHER, 20_000);

    // Восемь секунд, потраченные на ход, не возвращаются — только добавка.
    expect(back.blackMs).toBe(52_000);
    expect(back.whiteMs).toBe(60_000);
  });

  it('не уводит остаток в минус', () => {
    const almost = { ...initialClock(FISCHER), blackMs: 2_000, lastMoveAt: 0 };

    expect(rewindMove(almost, 'black', FISCHER, 1_000).blackMs).toBe(0);
  });

  it('в бёёми возвращать нечего: сгоревшие периоды остаются сгоревшими', () => {
    const burned = { ...initialClock(BYOYOMI), blackMs: 0, blackPeriods: 1, lastMoveAt: 0 };

    const back = rewindMove(burned, 'black', BYOYOMI, 5_000);

    expect(back.blackMs).toBe(0);
    expect(back.blackPeriods).toBe(1);
  });

  it('часы снова идут за тем, кто ходил: ход опять его', () => {
    const stopped = { ...initialClock(NONE), lastMoveAt: 1_000 };

    expect(rewindMove(stopped, 'white', NONE, 42_000).lastMoveAt).toBe(42_000);
  });
});
