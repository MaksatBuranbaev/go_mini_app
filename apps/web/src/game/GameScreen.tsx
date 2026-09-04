import { areaOwners, type GameState, type ScoreResult } from '@go/engine';
import { isMiniAppDark, useSignal } from '@telegram-apps/sdk-react';
import { Button } from '@telegram-apps/telegram-ui';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { archiveGame } from '../archive/save.js';
import { Board } from '../board/Board.js';
import { hasNativeButtons, useBackButton, useMainButton } from '../telegram/buttons.js';
import { confirmAction } from '../telegram/feedback.js';
import { colorName, illegalText, useGameStore } from './store.js';

export function GameScreen() {
  const {
    game,
    settings,
    record,
    pending,
    rejected,
    illegal,
    lastMove,
    dead,
    score,
    aim,
    clearAim,
    pass,
    undo,
    resign,
    toggleDead,
    acceptScore,
    resume,
    quit,
  } = useGameStore();
  const isDark = useSignal(isMiniAppDark);

  // Территория считается тем же движком, что и очки: подсветка не может
  // разойтись с итогом, даже если отметки мёртвых меняются на каждом тапе.
  const owners = useMemo(
    () => (game && game.phase !== 'playing' ? areaOwners(game, dead) : null),
    [game, dead],
  );

  // Партия на одном устройстве комнаты не имеет, поэтому id выдаём сами —
  // один на партию, чтобы повторные рендеры не плодили записи.
  const localId = useRef<string | null>(null);
  const archived = useRef(false);
  useEffect(() => {
    if (!game || game.phase !== 'finished' || archived.current) return;
    archived.current = true;
    localId.current ??= `hs${Date.now().toString(36)}`;

    void archiveGame({
      id: localId.current,
      size: game.size,
      komi: game.komi,
      handicap: game.handicap,
      result: game.result,
      rules: settings?.rules ?? 'chinese',
      record,
      black: 'Чёрные',
      white: 'Белые',
      local: true,
    }).catch((cause: unknown) => console.warn('[архив] партия не сохранилась', cause));
  }, [game, record, settings]);

  const doPass = useCallback(async () => {
    const confirmed = await confirmAction(
      'Пропустить ход? Два паса подряд заканчивают партию.',
      'Пас',
    );
    if (confirmed) pass();
  }, [pass]);

  const doResign = useCallback(async () => {
    const confirmed = await confirmAction('Сдать партию?', 'Сдаться');
    if (confirmed) resign();
  }, [resign]);

  const leave = useCallback(async () => {
    if (game && game.phase !== 'finished' && game.moveNumber > 0) {
      const confirmed = await confirmAction('Выйти из партии? Она не сохранится.', 'Выйти');
      if (!confirmed) return;
    }
    quit();
  }, [game, quit]);

  /** MainButton контекстна: пас в игре, приём счёта в подсчёте. Ход же
   * подтверждается вторым тапом по точке, кнопки для этого нет. */
  const main = useMemo(() => {
    if (!game || game.phase === 'finished') return null;
    if (game.phase === 'scoring') return { text: 'Принять счёт', run: acceptScore };
    return { text: 'Пас', run: doPass };
  }, [game, acceptScore, doPass]);

  useMainButton(
    useMemo(() => (main ? { text: main.text, onClick: () => void main.run() } : null), [main]),
  );
  useBackButton(useMemo(() => () => void leave(), [leave]));

  if (!game) return null;

  const nativeMain = hasNativeButtons();

  return (
    <div className="screen">
      <header className="status">
        <div className="status-main">{statusText(game, score)}</div>
        <div className="status-sub">
          {illegal !== null ? (
            <span className="status-warn">{illegalText(illegal)}</span>
          ) : (
            hintText(game, pending)
          )}
        </div>
      </header>

      <Board
        size={game.size}
        dark={isDark}
        board={game.board}
        lastMove={lastMove}
        pending={pending}
        pendingColor={game.toPlay}
        rejected={rejected}
        dead={dead}
        owners={owners}
        onTapPoint={game.phase === 'scoring' ? toggleDead : aim}
        onTapOutside={clearAim}
      />

      <footer className="actions">
        {game.phase === 'playing' && (
          <>
            {!nativeMain && main && (
              <Button size="l" stretched onClick={() => void main.run()}>
                {main.text}
              </Button>
            )}
            <div className="actions-row">
              {/* За одним устройством спрашивать некого: ход снимается сразу. */}
              <Button
                size="m"
                mode="outline"
                stretched
                disabled={record.length === 0}
                onClick={undo}
              >
                Отменить ход
              </Button>
              <Button size="m" mode="outline" stretched onClick={() => void doResign()}>
                Сдаться
              </Button>
            </div>
          </>
        )}

        {game.phase === 'scoring' && (
          <>
            {!nativeMain && (
              <Button size="l" stretched onClick={acceptScore}>
                Принять счёт
              </Button>
            )}
            <Button size="l" mode="outline" stretched onClick={resume}>
              Доиграть
            </Button>
          </>
        )}

        {game.phase === 'finished' && (
          <Button size="l" stretched onClick={quit}>
            В лобби
          </Button>
        )}
      </footer>
    </div>
  );
}

function statusText(game: GameState, score: ScoreResult | null): string {
  if (game.phase === 'finished') return resultText(game.result);
  if (game.phase === 'scoring') {
    return score ? `Чёрные ${score.black} : ${score.white} белые` : 'Подсчёт';
  }
  return `Ход ${colorName(game.toPlay)}`;
}

function hintText(game: GameState, pending: number | null): string {
  if (game.phase === 'scoring') return 'Отметьте мёртвые камни тапом по группе';
  if (game.phase === 'finished') return 'Партия окончена';
  if (pending !== null) return 'Тапните ещё раз по точке, чтобы поставить камень';
  return `Коми ${game.komi} · взято ${game.capturedByBlack}:${game.capturedByWhite}`;
}

function resultText(result: string | null): string {
  if (!result) return 'Партия окончена';
  if (result === 'Draw') return 'Ничья';
  const [side, margin] = result.split('+');
  const who = side === 'B' ? 'Чёрные' : 'Белые';
  if (margin === 'R') return `${who} выиграли: сдача`;
  if (margin === 'T') return `${who} выиграли: время`;
  return `${who} выиграли +${margin}`;
}
