import { describe, expect, it } from 'vitest';
import {
  BLACK,
  EMPTY,
  WHITE,
  createGame,
  fromDiagram,
  handicapPoints,
  legalMoves,
  play,
  replay,
  toDiagram,
  toIndex,
  type GameState,
  type Move,
} from '../src/index.js';

function expectLegal(state: GameState, move: Move): GameState {
  const result = play(state, move);
  if (!result.ok) throw new Error(`Ход отклонён: ${result.reason}`);
  return result.value;
}

function expectIllegal(state: GameState, move: Move): string {
  const result = play(state, move);
  if (result.ok) throw new Error('Ход прошёл, хотя должен был быть отклонён');
  return result.reason;
}

const stone = (state: GameState, x: number, y: number) =>
  state.board[toIndex(state.size, x, y)];

describe('постановка камня', () => {
  it('снимает окружённый камень противника', () => {
    const before = fromDiagram(
      [
        '.....',
        '..X..',
        '.XOX.',
        '.....',
        '.....',
      ],
      BLACK,
    );

    const after = expectLegal(before, { type: 'play', x: 2, y: 3 });

    expect(stone(after, 2, 2)).toBe(EMPTY);
    expect(after.capturedByBlack).toBe(1);
    expect(after.toPlay).toBe(WHITE);
  });

  it('отклоняет ход в занятую точку и за пределы доски', () => {
    const state = fromDiagram(['...', '.X.', '...'], WHITE);
    expect(expectIllegal(state, { type: 'play', x: 1, y: 1 })).toBe('occupied');
    expect(expectIllegal(state, { type: 'play', x: 3, y: 0 })).toBe('off-board');
  });

  it('считает дамэ по краю и в углу', () => {
    const corner = fromDiagram(['X..', '...', '...'], WHITE);
    // Камень в углу имеет два дамэ, поэтому двух ходов на его снятие мало.
    const step1 = expectLegal(corner, { type: 'play', x: 1, y: 0 });
    const step2 = expectLegal({ ...step1, toPlay: WHITE }, { type: 'play', x: 0, y: 1 });
    expect(stone(step2, 0, 0)).toBe(EMPTY);
    expect(step2.capturedByWhite).toBe(1);
  });
});

describe('самоубийство', () => {
  it('запрещено, когда ход не снимает ничего', () => {
    const state = fromDiagram(
      [
        '.....',
        '..X..',
        '.X.X.',
        '..X..',
        '.....',
      ],
      WHITE,
    );
    expect(expectIllegal(state, { type: 'play', x: 2, y: 2 })).toBe('suicide');
  });

  it('разрешено, если ход снимает группу противника', () => {
    // Белая цепочка вокруг единственного глаза: чёрный камень в глазу остаётся
    // без дамэ ровно до момента снятия белых, поэтому ход легален.
    const state = fromDiagram(
      [
        'XXXX.',
        'XOOOX',
        'XO.OX',
        'XOOOX',
        '.XXXX',
      ],
      BLACK,
    );

    const after = expectLegal(state, { type: 'play', x: 2, y: 2 });

    expect(after.capturedByBlack).toBe(8);
    expect(toDiagram(after)[1]).toBe('X...X');
  });
});

describe('ко', () => {
  const koShape = () =>
    fromDiagram(
      [
        '.XO..',
        'XO.O.',
        '.XO..',
        '.....',
        '.....',
      ],
      BLACK,
    );

  it('запрещает немедленное взятие обратно', () => {
    const captured = expectLegal(koShape(), { type: 'play', x: 2, y: 1 });
    expect(captured.capturedByBlack).toBe(1);
    expect(expectIllegal(captured, { type: 'play', x: 1, y: 1 })).toBe('superko');
  });

  it('под простым правилом ко даёт ту же причину отказа', () => {
    const state = fromDiagram(
      [
        '.XO..',
        'XO.O.',
        '.XO..',
        '.....',
        '.....',
      ],
      BLACK,
      { rules: { ko: 'simple', suicide: 'forbidden' } },
    );
    const captured = expectLegal(state, { type: 'play', x: 2, y: 1 });
    expect(expectIllegal(captured, { type: 'play', x: 1, y: 1 })).toBe('ko');
  });

  it('разрешает взятие обратно после хода в другом месте', () => {
    let state: GameState = expectLegal(koShape(), { type: 'play', x: 2, y: 1 });
    state = expectLegal(state, { type: 'play', x: 4, y: 4 }); // угроза белых
    state = expectLegal(state, { type: 'play', x: 0, y: 4 }); // ответ чёрных
    expect(play(state, { type: 'play', x: 1, y: 1 }).ok).toBe(true);
  });
});

describe('суперко', () => {
  it('отклоняет повторение любой позиции из истории, а не только предыдущей', () => {
    const start = fromDiagram(['...', '...', '...'], BLACK);
    const next = expectLegal(start, { type: 'play', x: 0, y: 0 });

    // Та же позиция, но её хеш заранее известен истории — как если бы она
    // встречалась десятком ходов раньше. Простое ко такое не ловит, суперко ловит.
    const seenBefore: GameState = {
      ...start,
      history: new Set([...start.history, next.hash]),
    };

    expect(expectIllegal(seenBefore, { type: 'play', x: 0, y: 0 })).toBe('superko');
    expect(play({ ...seenBefore, rules: { ko: 'simple', suicide: 'forbidden' } }, {
      type: 'play',
      x: 0,
      y: 0,
    }).ok).toBe(true);
  });
});

describe('пас, сдача и фора', () => {
  it('два паса переводят партию в подсчёт', () => {
    let state = createGame({ size: 9 });
    state = expectLegal(state, { type: 'pass' });
    expect(state.phase).toBe('playing');
    state = expectLegal(state, { type: 'pass' });
    expect(state.phase).toBe('scoring');
    expect(expectIllegal(state, { type: 'play', x: 0, y: 0 })).toBe('not-playing');
  });

  it('сдача завершает партию в пользу соперника', () => {
    const state = expectLegal(createGame({ size: 9 }), { type: 'resign' });
    expect(state.phase).toBe('finished');
    expect(state.result).toBe('W+R');
  });

  it('расставляет фору и отдаёт первый ход белым', () => {
    const state = createGame({ size: 19, handicap: 4 });
    expect(state.toPlay).toBe(WHITE);
    expect(state.board.reduce((sum, s) => sum + (s === BLACK ? 1 : 0), 0)).toBe(4);
    expect(handicapPoints(19, 9)).toHaveLength(9);
    expect(handicapPoints(9, 5)).toHaveLength(5);
    expect(handicapPoints(13, 1)).toHaveLength(0);
  });
});

describe('служебное', () => {
  it('перечисляет легальные ходы без занятых точек', () => {
    const state = fromDiagram(['X..', '...', '...'], WHITE);
    expect(legalMoves(state)).toHaveLength(8);
  });

  it('восстанавливает позицию прогоном ходов', () => {
    const moves: Move[] = [
      { type: 'play', x: 2, y: 2 },
      { type: 'play', x: 6, y: 6 },
      { type: 'play', x: 6, y: 2 },
    ];
    const result = replay({ size: 9 }, moves);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.moveNumber).toBe(3);
    expect(stone(result.value, 6, 2)).toBe(BLACK);
  });

  it('сообщает о нелегальном ходе при прогоне', () => {
    const result = replay({ size: 9 }, [
      { type: 'play', x: 0, y: 0 },
      { type: 'play', x: 0, y: 0 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('occupied');
  });
});
