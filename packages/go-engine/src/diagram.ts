import { stateFromBoard, type GameState } from './game.js';
import { BLACK, EMPTY, WHITE, type Color, type Stone } from './types.js';

/**
 * Позиции в тестах и в отладке задаются картинкой, а не списком ходов:
 * `X` — чёрные, `O` — белые, `.` — пусто. Пробелы внутри строки игнорируются,
 * так что диаграмму можно разрядить для читаемости.
 */
export function fromDiagram(
  rows: string[],
  toPlay: Color = BLACK,
  overrides: Partial<GameState> = {},
): GameState {
  const cleaned = rows.map((row) => row.replace(/\s+/g, '')).filter((row) => row.length > 0);
  const size = cleaned.length;

  for (const row of cleaned) {
    if (row.length !== size) {
      throw new Error(`Диаграмма не квадратная: строка "${row}" при размере ${size}`);
    }
  }

  const board = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const row = cleaned[y]!;
    for (let x = 0; x < size; x++) {
      const char = row[x]!;
      board[y * size + x] = char === 'X' ? BLACK : char === 'O' ? WHITE : EMPTY;
    }
  }

  return stateFromBoard(board, size, toPlay, overrides);
}

export function toDiagram(state: GameState): string[] {
  const rows: string[] = [];
  for (let y = 0; y < state.size; y++) {
    let row = '';
    for (let x = 0; x < state.size; x++) {
      const stone = state.board[y * state.size + x]! as Stone;
      row += stone === BLACK ? 'X' : stone === WHITE ? 'O' : '.';
    }
    rows.push(row);
  }
  return rows;
}
