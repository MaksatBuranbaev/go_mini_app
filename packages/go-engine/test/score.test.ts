import { describe, expect, it } from 'vitest';
import {
  areaOwners,
  BLACK,
  EMPTY,
  WHITE,
  defaultKomi,
  fromDiagram,
  guessDeadStones,
  play,
  score,
  scoreArea,
  scoreTerritory,
  toIndex,
} from '../src/index.js';

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

describe('японский подсчёт', () => {
  it('считает территорию и не считает свои камни', () => {
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

    const japanese = scoreTerritory(state, [], 0);
    const chinese = scoreArea(state, [], 0);

    // Территория у обеих систем одна и та же, расходится добавка к ней.
    expect(japanese.territory).toEqual(chinese.territory);
    expect(japanese.black).toBe(21);
    expect(chinese.black).toBe(25);
    expect(japanese.stones).toEqual({ black: 0, white: 0 });
  });

  it('мёртвый камень отдаёт и пункт, и себя в плен', () => {
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
    const result = scoreTerritory(state, [marked], 0);

    // Три белых камня уходят в плен, их пункты становятся территорией.
    expect(result.prisoners).toEqual({ black: 3, white: 0 });
    expect(result.territory.black).toBe(4);
    expect(result.black).toBe(7);
    expect(result.result).toBe('B+7');
  });

  it('засчитывает пленных, взятых во время партии', () => {
    // Белый камень в углу теряет последнюю свободу — чёрные берут пленного.
    const start = fromDiagram(
      [
        'OX...',
        '.....',
        '.....',
        '.....',
        '.....',
      ],
      BLACK,
    );

    const captured = play(start, { type: 'play', x: 0, y: 1 });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    expect(captured.value.capturedByBlack).toBe(1);
    expect(scoreTerritory(captured.value, [], 0).prisoners.black).toBe(1);
  });

  it('не даёт территории в общих дамэ', () => {
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

    const japanese = scoreTerritory(state, [], 0);

    expect(japanese.territory).toEqual({ black: 0, white: 0 });
    expect(japanese.result).toBe('Draw');
  });

  it('выбирается через общий вход', () => {
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

    expect(score(state, [], 'chinese', 0).black).toBe(25);
    expect(score(state, [], 'japanese', 0).black).toBe(21);
    // Без указания системы остаётся китайский — так игралось до появления выбора.
    expect(score(state, [], undefined, 0).black).toBe(25);
  });

  it('коми по умолчанию расходится только на 19×19', () => {
    expect(defaultKomi(19, 0, 'chinese')).toBe(7.5);
    expect(defaultKomi(19, 0, 'japanese')).toBe(6.5);
    expect(defaultKomi(13, 0, 'japanese')).toBe(6.5);
    expect(defaultKomi(9, 0, 'japanese')).toBe(5.5);
    expect(defaultKomi(19, 4, 'japanese')).toBe(0.5);
  });
});

describe('карта владельцев', () => {
  it('размечает пункты теми же областями, из которых складывается счёт', () => {
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

    const owners = areaOwners(state);
    const score = scoreArea(state, [], 0);

    let black = 0;
    let white = 0;
    let neutral = 0;
    for (const owner of owners) {
      if (owner === BLACK) black++;
      else if (owner === WHITE) white++;
      else neutral++;
    }

    // Средний столбец зажат между цветами и не достаётся никому.
    expect(neutral).toBe(5);
    expect(black).toBe(score.black);
    expect(white).toBe(score.white);
  });

  it('отдаёт пункты снятой мёртвой группы окружившему её цвету', () => {
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
    const owners = areaOwners(state, [marked]);

    expect(owners[marked]).toBe(BLACK);
    expect(owners.every((owner) => owner === BLACK)).toBe(true);
  });

  it('без пометок мёртвых оставляет живые камни своего цвета', () => {
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

    const owners = areaOwners(state);

    expect(owners[toIndex(5, 1, 1)]).toBe(WHITE);
    // Единственный пустой пункт окружён обоими цветами и ничей.
    expect(owners[toIndex(5, 3, 1)]).toBe(EMPTY);
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
