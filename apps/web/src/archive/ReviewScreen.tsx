import { createGame, fromSgf, play, type GameState } from '@go/engine';
import { isMiniAppDark, useSignal } from '@telegram-apps/sdk-react';
import { Button, Placeholder, Spinner } from '@telegram-apps/telegram-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchSgf } from '../api/room.js';
import { Board } from '../board/Board.js';
import { useBackButton } from '../telegram/buttons.js';
import { confirmAction } from '../telegram/feedback.js';
import { dateText, resultText } from './ArchiveScreen.js';
import { listGames, loadSgf, removeGame, type ArchivedGame } from './storage.js';

export interface ReviewScreenProps {
  id: string;
  onBack: () => void;
}

interface Loaded {
  entry: ArchivedGame | null;
  positions: GameState[];
  lastMoves: (number | null)[];
}

/** Просмотр сыгранной партии по ходам. */
export function ReviewScreen({ id, onBack }: ReviewScreenProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const isDark = useSignal(isMiniAppDark);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [entry, sgf] = await Promise.all([findEntry(id), readSgf(id)]);
        if (cancelled) return;
        if (!sgf) {
          setError('Запись партии не нашлась ни в облаке, ни в комнате.');
          return;
        }
        const replayed = replay(sgf);
        setLoaded({ entry, ...replayed });
        // Открываем на финальной позиции: чаще всего смотреть хотят именно её.
        setAt(replayed.positions.length - 1);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useBackButton(useMemo(() => onBack, [onBack]));

  const drop = useCallback(async () => {
    if (!(await confirmAction('Убрать партию из архива?', 'Удалить'))) return;
    await removeGame(id);
    onBack();
  }, [id, onBack]);

  if (error) {
    return (
      <Placeholder header="Партия не открылась" description={error}>
        <Button size="l" onClick={onBack}>
          К списку
        </Button>
      </Placeholder>
    );
  }

  if (!loaded) {
    return (
      <Placeholder header="Партия" description="Разбираем запись…">
        <Spinner size="m" />
      </Placeholder>
    );
  }

  const { entry, positions, lastMoves } = loaded;
  const last = positions.length - 1;
  const position = positions[at]!;

  return (
    <div className="screen">
      <header className="status">
        <div className="status-main">{resultText(entry?.result ?? position.result)}</div>
        <div className="status-sub">
          {at === 0 ? 'Начальная позиция' : `Ход ${at} из ${last}`}
          {entry ? ` · ${dateText(entry.at)}` : ''}
        </div>
      </header>

      <Board
        size={position.size}
        dark={isDark}
        board={position.board}
        lastMove={lastMoves[at] ?? null}
        pending={null}
        pendingColor={position.toPlay}
        rejected={null}
        dead={EMPTY_SET}
        owners={null}
        onTapPoint={NOOP}
      />

      <footer className="actions">
        <div className="actions-row">
          <Button size="m" mode="outline" stretched disabled={at === 0} onClick={() => setAt(0)}>
            ⏮
          </Button>
          <Button
            size="m"
            mode="outline"
            stretched
            disabled={at === 0}
            onClick={() => setAt((value) => Math.max(0, value - 1))}
          >
            ◀
          </Button>
          <Button
            size="m"
            mode="outline"
            stretched
            disabled={at === last}
            onClick={() => setAt((value) => Math.min(last, value + 1))}
          >
            ▶
          </Button>
          <Button size="m" mode="outline" stretched disabled={at === last} onClick={() => setAt(last)}>
            ⏭
          </Button>
        </div>
        <Button size="m" mode="plain" stretched onClick={() => void drop()}>
          Удалить из архива
        </Button>
      </footer>
    </div>
  );
}

const EMPTY_SET: ReadonlySet<number> = new Set<number>();
const NOOP = () => {};

async function findEntry(id: string): Promise<ArchivedGame | null> {
  return (await listGames()).find((entry) => entry.id === id) ?? null;
}

/**
 * Запись берётся из облака, а если её там нет — из самой комнаты: длинная
 * партия могла не влезть в лимит значения, но у комнаты ходы остались.
 */
async function readSgf(id: string): Promise<string | null> {
  const stored = await loadSgf(id);
  if (stored) return stored;
  try {
    return await fetchSgf(id);
  } catch {
    return null;
  }
}

/** Позиции после каждого хода — по ним и листает экран. */
function replay(sgf: string): { positions: GameState[]; lastMoves: (number | null)[] } {
  const record = fromSgf(sgf);
  let state = createGame({
    size: record.size,
    komi: record.komi,
    handicap: record.handicap,
  });

  const positions: GameState[] = [state];
  const lastMoves: (number | null)[] = [null];

  for (const entry of record.moves) {
    const result = play(state, entry.move);
    if (!result.ok) break;
    state = result.value;
    positions.push(state);
    lastMoves.push(
      entry.move.type === 'play' ? entry.move.y * record.size + entry.move.x : null,
    );
  }

  return { positions, lastMoves };
}
