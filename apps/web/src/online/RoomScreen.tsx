import type { GameSettings, Seat, SeatColor } from '@go/protocol';
import { isMiniAppDark, openTelegramLink, useSignal } from '@telegram-apps/sdk-react';
import { Button, Cell, Section } from '@telegram-apps/telegram-ui';
import { useCallback, useEffect, useMemo } from 'react';
import { inviteLink } from '../api/room.js';
import { Board } from '../board/Board.js';
import { hasNativeButtons, useBackButton, useMainButton } from '../telegram/buttons.js';
import { confirmAction } from '../telegram/feedback.js';
import { forgetRoom, rememberRoom } from './session.js';
import { engineColorOf, seatOf, useOnlineStore, type Connection } from './store.js';

const EMPTY_DEAD: ReadonlySet<number> = new Set();

export interface RoomScreenProps {
  roomId: string;
  /** Настройки известны до соединения — по ним рисуется скелетон доски. */
  settings: GameSettings;
  onLeave: () => void;
}

export function RoomScreen({ roomId, settings, onLeave }: RoomScreenProps) {
  const store = useOnlineStore();
  const isDark = useSignal(isMiniAppDark);
  const { connect, leave, aim, clearAim, confirmMove } = store;

  useEffect(() => {
    rememberRoom(roomId, settings);
    connect(roomId);
    return () => leave();
  }, [roomId, settings, connect, leave]);

  const exit = useCallback(async () => {
    if (store.status === 'playing') {
      const confirmed = await confirmAction('Выйти из партии? Комната останется.', 'Выйти');
      if (!confirmed) return;
    }
    forgetRoom();
    leave();
    onLeave();
  }, [store.status, leave, onLeave]);

  useBackButton(useMemo(() => () => void exit(), [exit]));

  const myTurn =
    store.game !== null &&
    store.status === 'playing' &&
    store.yourColor !== null &&
    seatOf(store.game.toPlay) === store.yourColor;

  const canConfirm = myTurn && store.pending !== null;

  // Кнопка не исчезает на чужом ходу, а гаснет: её появление и пропадание
  // двигает вьюпорт, доска пересчитывает раскладку, и второй тап
  // подтверждения улетает в соседнее пересечение.
  const main = useMemo(() => {
    if (store.status === 'waiting') {
      return { text: 'Позвать друга', onClick: () => share(roomId) };
    }
    if (store.status === 'playing') {
      return { text: 'Подтвердить ход', onClick: confirmMove, enabled: canConfirm };
    }
    return null;
  }, [store.status, canConfirm, roomId, confirmMove]);

  useMainButton(main);

  if (store.status === 'waiting') {
    return (
      <WaitingScreen
        roomId={roomId}
        settings={store.settings ?? settings}
        yourColor={store.yourColor}
        connection={store.connection}
        showAction={!hasNativeButtons()}
        onLeave={() => void exit()}
      />
    );
  }

  const size = store.settings?.size ?? settings.size;
  const board = store.game?.board ?? new Uint8Array(size * size);

  return (
    <div className="screen">
      <header className="status">
        <div className="status-main">{headline(store, myTurn)}</div>
        <div className="status-sub">
          {store.notice ? (
            <span className="status-warn">{store.notice}</span>
          ) : (
            subline(store.seats, store.online, store.yourColor, store.connection)
          )}
        </div>
      </header>

      <Board
        size={size}
        dark={isDark}
        board={board}
        lastMove={store.lastMove}
        pending={store.pending}
        pendingColor={engineColorOf(store.yourColor ?? 'black')}
        rejected={store.rejected}
        dead={EMPTY_DEAD}
        owners={null}
        onTapPoint={aim}
        onTapOutside={clearAim}
      />

      <footer className="actions">
        {!hasNativeButtons() && (
          <Button size="l" stretched disabled={!canConfirm} onClick={confirmMove}>
            Подтвердить ход
          </Button>
        )}
        <Button size="l" mode="outline" stretched onClick={() => void exit()}>
          Выйти
        </Button>
      </footer>
    </div>
  );
}

interface WaitingProps {
  roomId: string;
  settings: GameSettings;
  yourColor: SeatColor | null;
  connection: Connection;
  showAction: boolean;
  onLeave: () => void;
}

function WaitingScreen({
  roomId,
  settings,
  yourColor,
  connection,
  showAction,
  onLeave,
}: WaitingProps) {
  const link = inviteLink(roomId);

  return (
    <div className="screen screen-scroll">
      <header className="status">
        <div className="status-main">Ждём соперника</div>
        <div className="status-sub">{connectionText(connection)}</div>
      </header>

      <Section header="Партия" footer="Отправьте ссылку другу: кто откроет её первым, тот и сядет за доску.">
        <Cell subtitle="Доска">
          {settings.size}×{settings.size}
        </Cell>
        <Cell subtitle="Коми">{settings.komi}</Cell>
        <Cell subtitle="Фора">{settings.handicap === 0 ? 'нет' : settings.handicap}</Cell>
        <Cell subtitle="Вы играете">{yourColor ? colorWord(yourColor) : '—'}</Cell>
      </Section>

      <Section header="Ссылка">
        <div className="invite-link mono">{link}</div>
      </Section>

      <footer className="actions">
        {showAction && (
          <Button size="l" stretched onClick={() => share(roomId)}>
            Позвать друга
          </Button>
        )}
        <Button size="l" mode="outline" stretched onClick={onLeave}>
          В лобби
        </Button>
      </footer>
    </div>
  );
}

/**
 * Штатная шторка выбора чата. Inline-режим и код на стороне бота для этого
 * не нужны: ссылку разошлёт сам Telegram.
 */
function share(roomId: string): void {
  const url = `https://t.me/share/url?url=${encodeURIComponent(inviteLink(roomId))}`;
  if (openTelegramLink.isAvailable()) {
    openTelegramLink(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

function headline(store: ReturnType<typeof useOnlineStore.getState>, myTurn: boolean): string {
  if (store.status === 'finished') return 'Партия окончена';
  if (!store.game) return 'Открываем комнату…';
  return myTurn ? 'Ваш ход' : 'Ход соперника';
}

function subline(
  seats: Seat[],
  online: SeatColor[],
  yourColor: SeatColor | null,
  connection: Connection,
): string {
  if (connection !== 'online') return connectionText(connection);

  const opponent = seats.find((seat) => seat.color !== yourColor);
  if (!opponent) return 'Соперник ещё не сел за доску';
  return `${opponent.name} · ${online.includes(opponent.color) ? 'в сети' : 'отошёл'}`;
}

function connectionText(connection: Connection): string {
  switch (connection) {
    case 'connecting':
      return 'Соединяемся с комнатой…';
    case 'offline':
      return 'Связь потеряна, восстанавливаем…';
    case 'online':
      return 'В сети';
    case 'idle':
      return '';
  }
}

function colorWord(color: SeatColor): string {
  return color === 'black' ? 'чёрными' : 'белыми';
}
