import {
  BLACK,
  createGame,
  toSgf,
  type GameRecord,
  type RecordedMove,
  type ScoringRules,
} from '@go/engine';
import { saveGame, type ArchivedGame } from './storage.js';

export interface ArchiveInput {
  id: string;
  size: number;
  komi: number;
  handicap: number;
  result: string | null;
  rules: ScoringRules;
  record: RecordedMove[];
  black: string;
  white: string;
  local: boolean;
}

/** Собирает SGF законченной партии и кладёт её в архив игрока. */
export async function archiveGame(input: ArchiveInput): Promise<void> {
  const at = Date.now();

  const record: GameRecord = {
    size: input.size,
    komi: input.komi,
    handicap: input.handicap,
    moves: input.record,
    rules: input.rules,
    players: { black: input.black, white: input.white },
    date: new Date(at).toISOString().slice(0, 10),
    ...(input.result ? { result: input.result } : {}),
  };

  // Форовые камни — расстановка, а не ходы: чужие просмотрщики ждут их в AB.
  if (input.handicap >= 2) {
    const start = createGame({ size: input.size, komi: input.komi, handicap: input.handicap });
    const black: number[] = [];
    for (let i = 0; i < start.board.length; i++) if (start.board[i] === BLACK) black.push(i);
    record.setup = { black, white: [] };
  }

  const entry: ArchivedGame = {
    id: input.id,
    at,
    size: input.size,
    komi: input.komi,
    handicap: input.handicap,
    result: input.result,
    moves: input.record.length,
    black: input.black,
    white: input.white,
    local: input.local,
  };

  await saveGame(entry, toSgf(record));
}
