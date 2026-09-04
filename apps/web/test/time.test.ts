import { describe, expect, it } from 'vitest';
import { DEFAULT_TIER, controlText, lengthMinutes, timeTiers } from '../src/lobby/time.js';

const SIZES = [9, 13, 19];

describe('лестница времени', () => {
  it('у каждой доски своя: те же секунды на 19×19 — другая партия', () => {
    const first = SIZES.map((size) => controlText(timeTiers(size)[1]!.options[0]!));
    expect(first).toEqual(['2 мин + 7 сек', '3 мин + 7 сек', '5 мин + 7 сек']);
  });

  it('ступени идут от короткой к длинной', () => {
    for (const size of SIZES) {
      const minutes = timeTiers(size)
        .slice(0, -1)
        .map((tier) => lengthMinutes(tier.options[0]!, size));
      expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
      expect(new Set(minutes).size).toBe(minutes.length);
    }
  });

  it('варианты одной ступени близки по длине: подпись у них общая', () => {
    for (const size of SIZES) {
      for (const tier of timeTiers(size).slice(0, -1)) {
        const [increment, byoyomi] = tier.options.map((option) => lengthMinutes(option, size));
        expect(Math.abs(byoyomi! - increment!) / increment!).toBeLessThan(0.25);
      }
    }
  });

  it('подпись — круглое число, а не «27 мин»', () => {
    for (const size of SIZES) {
      for (const tier of timeTiers(size).slice(0, -1)) {
        expect(tier.label).toMatch(/^~ (5|10|15|20|30|40|45|1 ч|1 ч 15 мин|1 ч 30 мин)( мин)?$/);
      }
    }
  });

  it('партия без часов — отдельная последняя ступень', () => {
    for (const size of SIZES) {
      const last = timeTiers(size).at(-1)!;
      expect(last.options).toHaveLength(1);
      expect(controlText(last.options[0]!)).toBe('Без часов');
      expect(last.label).toBe('Сколько понадобится');
    }
  });

  it('ступень по умолчанию есть на любой доске', () => {
    for (const size of SIZES) expect(timeTiers(size)[DEFAULT_TIER]?.options[0]).toBeDefined();
  });

  it('незнакомая доска не роняет лобби', () => {
    expect(timeTiers(21)).toHaveLength(4);
  });
});
