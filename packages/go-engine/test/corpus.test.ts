import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BLACK,
  WHITE,
  createGame,
  fromSgf,
  play,
  stateFromBoard,
  type GameRecord,
  type GameState,
} from '../src/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function sgfFiles(): string[] {
  try {
    return readdirSync(fixtures)
      .filter((name) => name.toLowerCase().endsWith('.sgf'))
      .map((name) => join(fixtures, name));
  } catch {
    return [];
  }
}

/**
 * Чужие записи почти всегда japanese rules: там действует простое ко, а не суперко,
 * и партия с тройным ко на суперко была бы отвергнута законно, но без пользы.
 */
const CORPUS_RULES = { ko: 'simple', suicide: 'forbidden' } as const;

function initialState(record: GameRecord): GameState {
  if (!record.setup) {
    return createGame({
      size: record.size,
      komi: record.komi,
      handicap: record.handicap,
      rules: CORPUS_RULES,
    });
  }

  // Расстановка из AB/AW важнее поля HA: точки форы у разных серверов различаются.
  const board = new Uint8Array(record.size * record.size);
  for (const point of record.setup.black) board[point] = BLACK;
  for (const point of record.setup.white) board[point] = WHITE;
  const first = record.moves[0]?.color ?? WHITE;
  return stateFromBoard(board, record.size, first, {
    komi: record.komi,
    handicap: record.handicap,
    rules: CORPUS_RULES,
  });
}

const files = sgfFiles();

/**
 * Главная проверка движка: реальные партии должны проигрываться от начала до конца
 * без единого отказа. Корпус в репозиторий не кладётся — положите свои .sgf
 * в test/fixtures, и набор поднимется сам.
 */
describe('корпус SGF', () => {
  it.skipIf(files.length === 0)(`проигрывает партии из test/fixtures (${files.length} шт.)`, () => {
    const failures: string[] = [];

    for (const file of files) {
      const record = fromSgf(readFileSync(file, 'utf8'));
      let state = initialState(record);

      for (const [index, entry] of record.moves.entries()) {
        // Цвет из записи главнее очередности: в партиях с форой и в задачах
        // порядок ходов бывает нестандартным.
        const next = play({ ...state, toPlay: entry.color }, entry.move);
        if (!next.ok) {
          failures.push(`${file}: ход ${index + 1} отклонён (${next.reason})`);
          break;
        }
        state = next.value;
      }
    }

    expect(failures).toEqual([]);
  });
});
