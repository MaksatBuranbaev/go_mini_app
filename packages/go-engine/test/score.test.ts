import { describe, expect, it } from 'vitest';
import { BLACK, defaultKomi, fromDiagram, guessDeadStones, scoreArea, toIndex } from '../src/index.js';

describe('китайский подсчёт', () => {
  it('считает камни и окружённые пункты', () => {
    const state = fromDiagram(
      [
        'XX...',
        'XX...',
        '.....',
        '.....',
        '.....',
      ],
      BLACK,
    );

    const score = scoreArea(state, [], 0);

    expect(score.stones).toEqual({ black: 4, white: 0 });
    expect(score.territory).toEqual({ black: 21, white: 0 });
    expect(score.black).toBe(25);
    expect(score.white).toBe(0);
    expect(score.result).toBe('B+25');
  });

  it('не отдаёт никому область между двумя цветами', () => {
    const state = fromDiagram(
      [
        'XX.OO',
        'XX.OO',
        'XX.OO',
        'XX.OO',
        'XX.OO',
      ],
      BLACK,
    );

    const score = scoreArea(state, [], 0);

    expect(score.territory).toEqual({ black: 0, white: 0 });
    expect(score.black).toBe(10);
    expect(score.white).toBe(10);
    expect(score.result).toBe('Draw');
  });

  it('прибавляет коми белым и печатает дробный результат', () => {
    const state = fromDiagram(
      [
        'XX.OO',
        'XX.OO',
        'XX.OO',
        'XX.OO',
        'XX.OO',
      ],
      BLACK,
    );

    expect(scoreArea(state, [], 5.5).result).toBe('W+5.5');
  });

  it('снимает мёртвую группу целиком по одной отмеченной точке', () => {
    const state = fromDiagram(
      [
        'XXXXX',
        'XOO.X',
        'XOXXX',
        'XXXXX',
        'XXXXX',
      ],
      BLACK,
    );

    const marked = toIndex(5, 1, 1);
    const score = scoreArea(state, [marked], 0);

    // Три белых камня снялись, освободившиеся пункты достались чёрным.
    expect(score.stones.white).toBe(0);
    expect(score.black).toBe(25);
    expect(score.result).toBe('B+25');
  });

  it('подсказывает мёртвые камни, не решая за игроков', () => {
    const state = fromDiagram(
      [
        'XXXXX',
        'XOO.X',
        'XOXXX',
        'XXXXX',
        'XXXXX',
      ],
      BLACK,
    );

    expect(guessDeadStones(state).length).toBeGreaterThan(0);
  });
});

describe('коми по умолчанию', () => {
  it('зависит от размера доски и обнуляется при форе', () => {
    expect(defaultKomi(19)).toBe(7.5);
    expect(defaultKomi(13)).toBe(6.5);
    expect(defaultKomi(9)).toBe(5.5);
    expect(defaultKomi(19, 4)).toBe(0.5);
  });
});
