import { neighbors } from './board.js';
import { BLACK, EMPTY, WHITE, type Color, type ScoringRules, type Stone } from './types.js';
import type { GameState } from './game.js';

export interface ScoreResult {
  /** Итог стороны. Коми в `white` уже включено. */
  black: number;
  white: number;
  /** Строка в формате SGF: `B+7.5`, `W+2.5`, `Draw`. */
  result: string;
  territory: { black: number; white: number };
  /** Камни на доске: дают очки только в китайском счёте. */
  stones: { black: number; white: number };
  /** Пленные вместе со снятыми мёртвыми: дают очки только в японском. */
  prisoners: { black: number; white: number };
}

/** Счёт по выбранной системе. Единственная точка, где системы расходятся. */
export function score(
  state: GameState,
  dead: Iterable<number> = [],
  rules: ScoringRules = 'chinese',
  komi: number = state.komi,
): ScoreResult {
  return rules === 'japanese'
    ? scoreTerritory(state, dead, komi)
    : scoreArea(state, dead, komi);
}

/**
 * Китайский подсчёт (area scoring): очко за каждый свой камень на доске и за
 * каждый окружённый пункт. Мёртвые камни снимаются перед счётом и достаются
 * тому, кто их окружил, — отдельный учёт пленных не нужен.
 *
 * `dead` — индексы точек, помеченных игроками как мёртвые. Достаточно одной
 * точки из группы: снимается вся связанная цепочка.
 */
export function scoreArea(
  state: GameState,
  dead: Iterable<number> = [],
  komi: number = state.komi,
): ScoreResult {
  const { size } = state;
  const board = Uint8Array.from(state.board);

  for (const point of expandGroups(board, size, dead)) board[point] = EMPTY;

  let blackStones = 0;
  let whiteStones = 0;
  for (const stone of board) {
    if (stone === BLACK) blackStones++;
    else if (stone === WHITE) whiteStones++;
  }

  const territory = countTerritory(board, size);

  const black = blackStones + territory.black;
  const white = whiteStones + territory.white + komi;

  return {
    black,
    white,
    result: formatResult(black - white),
    territory,
    stones: { black: blackStones, white: whiteStones },
    prisoners: { black: 0, white: 0 },
  };
}

/**
 * Японский подсчёт (territory scoring): очко за каждый окружённый пункт и за
 * каждого пленного. Свои камни на доске очков не дают — поэтому лишний ход
 * внутри собственной территории здесь стоит очко, в отличие от китайского.
 *
 * Мёртвый камень — двойная потеря: его пункт достаётся сопернику территорией,
 * и сам он уходит сопернику в плен.
 *
 * Про сэки: пустая область, граничащая с обоими цветами, не даёт очков никому
 * — это ровно случай общих дамэ. Сэки с глазами (глаза внутри такой позиции
 * японские правила тоже не считают) движок не распознаёт, и в редкой позиции
 * даст территорию там, где судья не дал бы. Полное определение сэки требует
 * анализа жизни и смерти, которого у нас нет.
 */
export function scoreTerritory(
  state: GameState,
  dead: Iterable<number> = [],
  komi: number = state.komi,
): ScoreResult {
  const { size } = state;
  const board = Uint8Array.from(state.board);

  let deadBlack = 0;
  let deadWhite = 0;
  for (const point of expandGroups(board, size, dead)) {
    if (board[point] === BLACK) deadBlack++;
    else deadWhite++;
    board[point] = EMPTY;
  }

  const territory = countTerritory(board, size);
  const prisoners = {
    black: state.capturedByBlack + deadWhite,
    white: state.capturedByWhite + deadBlack,
  };

  const black = territory.black + prisoners.black;
  const white = territory.white + prisoners.white + komi;

  return {
    black,
    white,
    result: formatResult(black - white),
    territory,
    stones: { black: 0, white: 0 },
    prisoners,
  };
}

/** Расширяет отмеченные точки до полных групп: игрок тапает по камню, умирает цепочка. */
function expandGroups(board: Uint8Array, size: number, seeds: Iterable<number>): Set<number> {
  const result = new Set<number>();
  const nbuf = new Int32Array(4);

  for (const seed of seeds) {
    const color = board[seed];
    if (color === undefined || color === EMPTY || result.has(seed)) continue;
    const stack = [seed];
    result.add(seed);
    while (stack.length > 0) {
      const index = stack.pop()!;
      const n = neighbors(size, index, nbuf);
      for (let k = 0; k < n; k++) {
        const next = nbuf[k]!;
        if (board[next] === color && !result.has(next)) {
          result.add(next);
          stack.push(next);
        }
      }
    }
  }

  return result;
}

/**
 * Пустая область достаётся цвету, если граничит ровно с ним одним.
 * Область, зажатая между двумя цветами (сэки или недоигранная граница), не даёт очков никому.
 */
function countTerritory(
  board: Uint8Array,
  size: number,
  owners?: Uint8Array,
): { black: number; white: number } {
  const seen = new Uint8Array(size * size);
  const nbuf = new Int32Array(4);
  let black = 0;
  let white = 0;

  for (let start = 0; start < board.length; start++) {
    if (board[start] !== EMPTY || seen[start] === 1) continue;

    const region: number[] = [];
    const stack = [start];
    seen[start] = 1;
    let touchesBlack = false;
    let touchesWhite = false;

    while (stack.length > 0) {
      const index = stack.pop()!;
      region.push(index);
      const n = neighbors(size, index, nbuf);
      for (let k = 0; k < n; k++) {
        const next = nbuf[k]!;
        const stone: Stone = board[next]! as Stone;
        if (stone === EMPTY) {
          if (seen[next] === 0) {
            seen[next] = 1;
            stack.push(next);
          }
        } else if (stone === BLACK) touchesBlack = true;
        else touchesWhite = true;
      }
    }

    if (touchesBlack && !touchesWhite) {
      black += region.length;
      if (owners) for (const point of region) owners[point] = BLACK;
    } else if (touchesWhite && !touchesBlack) {
      white += region.length;
      if (owners) for (const point of region) owners[point] = WHITE;
    }
  }

  return { black, white };
}

/**
 * Кому принадлежит каждый пункт после снятия мёртвых камней: `EMPTY`, `BLACK` или `WHITE`.
 * Живые камни остаются своим цветом, пустые пункты получают цвет окружившего их игрока,
 * спорные области — `EMPTY`. Считается тем же обходом, что и очки, поэтому подсветка
 * территории в UI не может разойтись с итоговым счётом.
 *
 * Карта общая для обеих систем: территорию они делят одинаково, расходятся
 * только в том, что к ней прибавляют — камни на доске или пленных.
 */
export function areaOwners(state: GameState, dead: Iterable<number> = []): Uint8Array {
  const { size } = state;
  const board = Uint8Array.from(state.board);
  for (const point of expandGroups(board, size, dead)) board[point] = EMPTY;

  const owners = Uint8Array.from(board);
  countTerritory(board, size, owners);
  return owners;
}

export function formatResult(difference: number): string {
  if (difference === 0) return 'Draw';
  const winner: Color = difference > 0 ? BLACK : WHITE;
  const margin = Math.abs(difference);
  return `${winner === BLACK ? 'B' : 'W'}+${trimNumber(margin)}`;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Подсказка для фазы подсчёта, не приговор: группа считается мёртвой, если у неё
 * мало дамэ и она целиком окружена одним чужим цветом. Финальное слово за игроками.
 */
export function guessDeadStones(state: GameState): number[] {
  const { size, board } = state;
  const nbuf = new Int32Array(4);
  const seen = new Uint8Array(size * size);
  const dead: number[] = [];

  for (let start = 0; start < board.length; start++) {
    const color = board[start]!;
    if (color === EMPTY || seen[start] === 1) continue;

    const group: number[] = [];
    const stack = [start];
    seen[start] = 1;
    const libertyPoints = new Set<number>();
    let touchesOther = false;

    while (stack.length > 0) {
      const index = stack.pop()!;
      group.push(index);
      const n = neighbors(size, index, nbuf);
      for (let k = 0; k < n; k++) {
        const next = nbuf[k]!;
        const stone = board[next]!;
        if (stone === EMPTY) libertyPoints.add(next);
        else if (stone === color) {
          if (seen[next] === 0) {
            seen[next] = 1;
            stack.push(next);
          }
        } else touchesOther = true;
      }
    }

    if (touchesOther && libertyPoints.size <= 2 && group.length <= 6) dead.push(start);
  }

  return dead;
}
