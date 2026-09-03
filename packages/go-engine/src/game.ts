import { groupAt, neighbors, onBoard, toIndex } from './board.js';
import {
  BLACK,
  DEFAULT_RULES,
  EMPTY,
  WHITE,
  err,
  ok,
  opponent,
  type Color,
  type Move,
  type Phase,
  type Result,
  type Rules,
} from './types.js';
import { hashBoard, stoneHash } from './zobrist.js';

export interface GameState {
  readonly size: number;
  readonly board: Uint8Array;
  readonly toPlay: Color;
  readonly hash: bigint;
  /** Все встречавшиеся позиции, включая текущую. Основа проверки суперко. */
  readonly history: ReadonlySet<bigint>;
  /** Позиция до последнего хода — этого достаточно для простого ко. */
  readonly previousHash: bigint | null;
  readonly capturedByBlack: number;
  readonly capturedByWhite: number;
  readonly passes: number;
  readonly moveNumber: number;
  readonly phase: Phase;
  readonly result: string | null;
  readonly komi: number;
  readonly handicap: number;
  readonly rules: Rules;
}

export interface GameOptions {
  size: number;
  komi?: number;
  handicap?: number;
  rules?: Partial<Rules>;
}

/** Коми по умолчанию для китайского подсчёта: ничьих не бывает. */
export function defaultKomi(size: number, handicap = 0): number {
  if (handicap > 0) return 0.5;
  return size === 19 ? 7.5 : size === 13 ? 6.5 : 5.5;
}

/** Гандикапные точки в стандартном порядке размещения. */
export function handicapPoints(size: number, count: number): number[] {
  if (count < 2) return [];
  const edge = size >= 13 ? 3 : 2;
  const far = size - 1 - edge;
  const mid = (size - 1) / 2;
  const idx = (x: number, y: number) => toIndex(size, x, y);

  const corners = [idx(edge, far), idx(far, edge), idx(edge, edge), idx(far, far)];
  const sides = [idx(edge, mid), idx(far, mid), idx(mid, edge), idx(mid, far)];
  const tengen = idx(mid, mid);

  const take = Math.min(count, 9);
  const points: number[] = corners.slice(0, Math.min(take, 4));
  // Нечётная фора от пяти камней всегда включает тэнгэн, остаток добирается сторонами.
  if (take >= 5 && take % 2 === 1) points.push(tengen);
  if (take >= 6) points.push(...sides.slice(0, take >= 8 ? 4 : 2));
  return points;
}

export function createGame(options: GameOptions): GameState {
  const { size } = options;
  const handicap = options.handicap ?? 0;
  const rules = { ...DEFAULT_RULES, ...options.rules };
  const board = new Uint8Array(size * size);

  for (const point of handicapPoints(size, handicap)) board[point] = BLACK;

  const hash = hashBoard(size, board);
  return {
    size,
    board,
    // При форе чёрные уже расставлены, первый ход за белыми.
    toPlay: handicap >= 2 ? WHITE : BLACK,
    hash,
    history: new Set([hash]),
    previousHash: null,
    capturedByBlack: 0,
    capturedByWhite: 0,
    passes: 0,
    moveNumber: 0,
    phase: 'playing',
    result: null,
    komi: options.komi ?? defaultKomi(size, handicap),
    handicap,
    rules,
  };
}

/** Собирает состояние из готовой доски — для тестов, диаграмм и восстановления из снапшота. */
export function stateFromBoard(
  board: Uint8Array,
  size: number,
  toPlay: Color,
  overrides: Partial<GameState> = {},
): GameState {
  const hash = hashBoard(size, board);
  return {
    size,
    board,
    toPlay,
    hash,
    history: new Set([hash]),
    previousHash: null,
    capturedByBlack: 0,
    capturedByWhite: 0,
    passes: 0,
    moveNumber: 0,
    phase: 'playing',
    result: null,
    komi: defaultKomi(size),
    handicap: 0,
    rules: DEFAULT_RULES,
    ...overrides,
  };
}

export function isLegal(state: GameState, move: Move): boolean {
  return play(state, move).ok;
}

/** Все легальные точки для текущего игрока — нужно UI для подсветки и тестам. */
export function legalMoves(state: GameState): number[] {
  const moves: number[] = [];
  for (let i = 0; i < state.board.length; i++) {
    if (state.board[i] !== EMPTY) continue;
    const x = i % state.size;
    const y = (i / state.size) | 0;
    if (play(state, { type: 'play', x, y }).ok) moves.push(i);
  }
  return moves;
}

export function play(state: GameState, move: Move): Result<GameState> {
  if (state.phase !== 'playing') return err('not-playing');

  switch (move.type) {
    case 'pass':
      return ok(applyPass(state));
    case 'resign':
      return ok(applyResign(state));
    case 'play':
      return applyStone(state, move.x, move.y);
  }
}

function applyPass(state: GameState): GameState {
  const passes = state.passes + 1;
  return {
    ...state,
    toPlay: opponent(state.toPlay),
    passes,
    moveNumber: state.moveNumber + 1,
    // Пас снимает ко: позиция не менялась, повторять больше нечего.
    previousHash: state.hash,
    phase: passes >= 2 ? 'scoring' : 'playing',
  };
}

function applyResign(state: GameState): GameState {
  return {
    ...state,
    moveNumber: state.moveNumber + 1,
    phase: 'finished',
    result: state.toPlay === BLACK ? 'W+R' : 'B+R',
  };
}

function applyStone(state: GameState, x: number, y: number): Result<GameState> {
  const { size, rules } = state;
  if (!onBoard(size, x, y)) return err('off-board');

  const index = toIndex(size, x, y);
  if (state.board[index] !== EMPTY) return err('occupied');

  const color = state.toPlay;
  const enemy = opponent(color);
  const board = Uint8Array.from(state.board);
  const stones = new Int32Array(size * size);
  const nbuf = new Int32Array(4);

  board[index] = color;
  let hash = state.hash ^ stoneHash(size, index, color);
  let captured = 0;

  const n = neighbors(size, index, nbuf);
  for (let k = 0; k < n; k++) {
    const next = nbuf[k]!;
    if (board[next] !== enemy) continue;
    const group = groupAt(board, size, next, stones);
    if (group.liberties > 0) continue;
    for (let s = 0; s < group.count; s++) {
      const stone = stones[s]!;
      board[stone] = EMPTY;
      hash ^= stoneHash(size, stone, enemy);
    }
    captured += group.count;
  }

  // Своя группа проверяется после снятия чужих: ход, отнимающий последнее дамэ
  // у противника, легален, даже если до снятия выглядел самоубийством.
  if (groupAt(board, size, index, stones).liberties === 0) {
    if (rules.suicide === 'forbidden') return err('suicide');
    const group = groupAt(board, size, index, stones);
    for (let s = 0; s < group.count; s++) {
      const stone = stones[s]!;
      board[stone] = EMPTY;
      hash ^= stoneHash(size, stone, color);
    }
  }

  if (rules.ko === 'simple') {
    if (state.previousHash !== null && hash === state.previousHash) return err('ko');
  } else if (state.history.has(hash)) {
    return err('superko');
  }

  const history = new Set(state.history);
  history.add(hash);

  return ok({
    ...state,
    board,
    toPlay: enemy,
    hash,
    history,
    previousHash: state.hash,
    capturedByBlack: state.capturedByBlack + (color === BLACK ? captured : 0),
    capturedByWhite: state.capturedByWhite + (color === WHITE ? captured : 0),
    passes: 0,
    moveNumber: state.moveNumber + 1,
  });
}

/** Возврат из фазы подсчёта к игре, если игроки не сошлись в мёртвых камнях. */
export function resumePlay(state: GameState): GameState {
  if (state.phase !== 'scoring') return state;
  return { ...state, phase: 'playing', passes: 0 };
}

export function finish(state: GameState, result: string): GameState {
  return { ...state, phase: 'finished', result };
}

/**
 * Прогон списка ходов. Комната восстанавливает позицию именно так — после
 * гибернации в памяти не остаётся ничего, кроме записанных в storage ходов.
 */
export function replay(options: GameOptions, moves: Move[]): Result<GameState> {
  let state = createGame(options);
  for (const move of moves) {
    const next = play(state, move);
    if (!next.ok) return next;
    state = next.value;
  }
  return ok(state);
}
