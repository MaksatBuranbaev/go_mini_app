import { areaOwners, type GameState, type ScoreResult } from '@go/engine';
import {
  backButton,
  isMiniAppDark,
  mainButton,
  useSignal,
} from '@telegram-apps/sdk-react';
import { Button } from '@telegram-apps/telegram-ui';
import { useCallback, useEffect, useMemo } from 'react';
import { Board } from '../board/Board.js';
import { confirmAction } from '../telegram/feedback.js';
import { isMockedEnv } from '../telegram/mockEnv.js';
import { colorName, illegalText, useGameStore } from './store.js';

export function GameScreen() {
  const {
    game,
    pending,
    rejected,
    illegal,
    lastMove,
    dead,
    score,
    aim,
    clearAim,
    confirmMove,
    pass,
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

  /** MainButton контекстна: подтверждение хода, пас или приём счёта. */
  const main = useMemo(() => {
    if (!game || game.phase === 'finished') return null;
    if (game.phase === 'scoring') return { text: 'Принять счёт', run: acceptScore };
    if (pending !== null) return { text: 'Подтвердить ход', run: confirmMove };
    return { text: 'Пас', run: doPass };
  }, [game, pending, acceptScore, confirmMove, doPass]);

  useEffect(() => {
    if (!mainButton.setParams.isAvailable()) return;
    if (main) mainButton.setParams({ text: main.text, isVisible: true, isEnabled: true });
    else mainButton.setParams({ isVisible: false });
  }, [main]);

  useEffect(() => {
    if (!main || !mainButton.onClick.isAvailable()) return;
    const handler = () => void main.run();
    mainButton.onClick(handler);
    return () => mainButton.offClick(handler);
  }, [main]);

  useEffect(
    () => () => {
      if (mainButton.setParams.isAvailable()) mainButton.setParams({ isVisible: false });
    },
    [],
  );

  useEffect(() => {
    if (!backButton.show.isAvailable()) return;
    backButton.show();
    const handler = () => void leave();
    backButton.onClick(handler);
    return () => {
      backButton.offClick(handler);
      if (backButton.hide.isAvailable()) backButton.hide();
    };
  }, [leave]);

  if (!game) return null;

  // За моком SDK рапортует, что MainButton доступна, но рисовать её некому:
  // вне Telegram основное действие уходит в кнопку на самом экране.
  const nativeMain = mainButton.setParams.isAvailable() && !isMockedEnv();

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
            <Button size="l" mode="outline" stretched onClick={() => void doResign()}>
              Сдаться
            </Button>
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
