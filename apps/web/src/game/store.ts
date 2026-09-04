import {
  BLACK,
  EMPTY,
  createGame,
  defaultKomi,
  finish,
  groupAt,
  guessDeadStones,
  play,
  resumePlay,
  score as scoreBy,
  type GameState,
  type IllegalReason,
  type RecordedMove,
  type ScoreResult,
  type ScoringRules,
} from '@go/engine';
import { create } from 'zustand';
import {
  aimFeedback,
  captureFeedback,
  passFeedback,
  rejectFeedback,
  stoneFeedback,
} from '../telegram/feedback.js';

export interface GameSettings {
  size: number;
  handicap: number;
  komi: number;
  rules: ScoringRules;
}

export const BOARD_SIZES = [9, 13, 19] as const;
export const HANDICAPS = [0, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export function settingsFor(
  size: number,
  handicap: number,
  rules: ScoringRules = 'chinese',
): GameSettings {
  return { size, handicap, komi: defaultKomi(size, handicap, rules), rules };
}

interface GameStore {
  game: GameState | null;
  settings: GameSettings | null;
  /** Ходы по порядку — из них собирается SGF для архива. */
  record: RecordedMove[];
  /** Намеченный, но не подтверждённый ход — первый тап из двух. */
  pending: number | null;
  /** Последняя точка, отвергнутая правилами: держится до следующего тапа. */
  rejected: number | null;
  illegal: IllegalReason | null;
  lastMove: number | null;
  dead: Set<number>;
  score: ScoreResult | null;

  start: (settings: GameSettings) => void;
  quit: () => void;
  aim: (point: number) => void;
  clearAim: () => void;
  confirmMove: () => void;
  pass: () => void;
  resign: () => void;
  toggleDead: (point: number) => void;
  acceptScore: () => void;
  resume: () => void;
}

const IDLE = {
  game: null,
  settings: null,
  record: [] as RecordedMove[],
  pending: null,
  rejected: null,
  illegal: null,
  lastMove: null,
  dead: new Set<number>(),
  score: null,
};

export const useGameStore = create<GameStore>((set, get) => ({
  ...IDLE,

  start: (settings) => {
    set({
      ...IDLE,
      dead: new Set<number>(),
      settings,
      game: createGame({ size: settings.size, komi: settings.komi, handicap: settings.handicap }),
    });
  },

  quit: () => set({ ...IDLE, dead: new Set<number>() }),

  aim: (point) => {
    const { game, pending } = get();
    if (!game || game.phase !== 'playing') return;

    // Повторный тап по той же точке — это и есть подтверждение.
    if (pending === point) {
      get().confirmMove();
      return;
    }

    const result = play(game, { type: 'play', ...coords(game, point) });
    if (!result.ok) {
      rejectFeedback();
      set({ pending: null, rejected: point, illegal: result.reason });
      return;
    }

    aimFeedback();
    set({ pending: point, rejected: null, illegal: null });
  },

  clearAim: () => set({ pending: null, rejected: null, illegal: null }),

  confirmMove: () => {
    const { game, pending } = get();
    if (!game || pending === null) return;

    const result = play(game, { type: 'play', ...coords(game, pending) });
    if (!result.ok) {
      rejectFeedback();
      set({ pending: null, rejected: pending, illegal: result.reason });
      return;
    }

    const next = result.value;
    const captured =
      next.capturedByBlack - game.capturedByBlack + (next.capturedByWhite - game.capturedByWhite);
    if (captured > 0) captureFeedback();
    else stoneFeedback();

    set({
      game: next,
      record: [...get().record, { color: game.toPlay, move: { type: 'play', ...coords(game, pending) } }],
      lastMove: pending,
      pending: null,
      rejected: null,
      illegal: null,
    });
  },

  pass: () => {
    const { game } = get();
    if (!game || game.phase !== 'playing') return;

    const result = play(game, { type: 'pass' });
    if (!result.ok) return;

    const next = result.value;
    passFeedback();

    const record: RecordedMove[] = [...get().record, { color: game.toPlay, move: { type: 'pass' } }];

    if (next.phase !== 'scoring') {
      set({ game: next, record, lastMove: null, pending: null, rejected: null, illegal: null });
      return;
    }

    // Второй пас: подсказываем мёртвые группы, но решают всё равно игроки.
    const dead = new Set<number>();
    for (const seed of guessDeadStones(next)) {
      for (const point of groupPoints(next, seed)) dead.add(point);
    }
    set({
      game: next,
      record,
      lastMove: null,
      pending: null,
      rejected: null,
      illegal: null,
      dead,
      score: scoreBy(next, dead, get().settings?.rules),
    });
  },

  resign: () => {
    const { game } = get();
    if (!game || game.phase !== 'playing') return;
    const result = play(game, { type: 'resign' });
    if (result.ok) set({ game: result.value, pending: null, rejected: null, illegal: null });
  },

  toggleDead: (point) => {
    const { game, dead } = get();
    if (!game || game.phase !== 'scoring') return;
    if (game.board[point] === EMPTY) return;

    const group = groupPoints(game, point);
    const next = new Set(dead);
    const wasDead = group.every((stone) => next.has(stone));
    for (const stone of group) {
      if (wasDead) next.delete(stone);
      else next.add(stone);
    }

    aimFeedback();
    set({ dead: next, score: scoreBy(game, next, get().settings?.rules) });
  },

  acceptScore: () => {
    const { game, dead } = get();
    if (!game || game.phase !== 'scoring') return;
    const score = scoreBy(game, dead, get().settings?.rules);
    set({ game: finish(game, score.result), score });
  },

  resume: () => {
    const { game } = get();
    if (!game || game.phase !== 'scoring') return;
    set({
      game: resumePlay(game),
      dead: new Set<number>(),
      score: null,
      pending: null,
      rejected: null,
      illegal: null,
    });
  },
}));

function coords(game: GameState, point: number): { x: number; y: number } {
  return { x: point % game.size, y: (point / game.size) | 0 };
}

/** Вся цепочка, к которой принадлежит камень: тап по одному камню отмечает группу. */
function groupPoints(game: GameState, point: number): number[] {
  const stones = new Int32Array(game.size * game.size);
  const info = groupAt(game.board, game.size, point, stones);
  return Array.from(stones.subarray(0, info.count));
}

export function illegalText(reason: IllegalReason): string {
  switch (reason) {
    case 'occupied':
      return 'Пункт занят';
    case 'suicide':
      return 'Самоубийство запрещено';
    case 'ko':
      return 'Ко: сюда нельзя сразу';
    case 'superko':
      return 'Позиция уже встречалась';
    case 'off-board':
      return 'Мимо доски';
    case 'not-playing':
      return 'Партия не идёт';
  }
}

export function colorName(color: number): string {
  return color === BLACK ? 'чёрных' : 'белых';
}
