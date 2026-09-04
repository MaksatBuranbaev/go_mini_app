import { areaOwners } from '@go/engine';
import type { GameSettings, Seat, SeatColor } from '@go/protocol';
import { isMiniAppDark, openTelegramLink, useSignal } from '@telegram-apps/sdk-react';
import { Button, Cell, Section } from '@telegram-apps/telegram-ui';
import { useCallback, useEffect, useMemo } from 'react';
import { inviteLink } from '../api/room.js';
import { Board } from '../board/Board.js';
import { hasNativeButtons, useBackButton, useMainButton } from '../telegram/buttons.js';
import { confirmAction } from '../telegram/feedback.js';
import { Clocks } from './Clocks.js';
import { forgetRoom, rememberRoom } from './session.js';
import { engineColorOf, seatOf, useOnlineStore, type Connection } from './store.js';

export interface RoomScreenProps {
  roomId: string;
  /** Настройки известны до соединения — по ним рисуется скелетон доски. */
  settings: GameSettings;
  onLeave: () => void;
}

export function RoomScreen({ roomId, settings, onLeave }: RoomScreenProps) {
  const store = useOnlineStore();
  const isDark = useSignal(isMiniAppDark);
  const { connect, leave, aim, clearAim, confirmMove, toggleDead } = store;

  useEffect(() => {
    rememberRoom(roomId, settings);
    connect(roomId);
    return () => leave();
  }, [roomId, settings, connect, leave]);

  const exit = useCallback(async () => {
    if (store.status === 'playing' || store.status === 'scoring') {
      const confirmed = await confirmAction('Выйти из партии? Комната останется.', 'Выйти');
      if (!confirmed) return;
    }
    forgetRoom();
    leave();
    onLeave();
  }, [store.status, leave, onLeave]);

  const doPass = useCallback(async () => {
    const confirmed = await confirmAction(
      'Пропустить ход? Два паса подряд заканчивают партию.',
      'Пас',
    );
    if (confirmed) store.pass();
  }, [store]);

  const doResign = useCallback(async () => {
    const confirmed = await confirmAction('Сдать партию?', 'Сдаться');
    if (confirmed) store.resign();
  }, [store]);

  useBackButton(useMemo(() => () => void exit(), [exit]));

  const dead = useMemo(() => new Set(store.scoring?.dead ?? []), [store.scoring]);

  // Территория считается тем же движком, что и очки: подсветка не может
  // разойтись с итогом, даже если отметки мёртвых меняются на каждом тапе.
  const owners = useMemo(
    () =>
      store.game && (store.status === 'scoring' || store.status === 'finished')
        ? areaOwners(store.game, dead)
        : null,
    [store.game, store.status, dead],
  );

  const myTurn =
    store.game !== null &&
    store.status === 'playing' &&
    store.yourColor !== null &&
    seatOf(store.game.toPlay) === store.yourColor;

  const canConfirm = myTurn && store.pending !== null;
  const accepted = store.scoring?.acceptedBy ?? [];
  const iAccepted = store.yourColor !== null && accepted.includes(store.yourColor);

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
    if (store.status === 'scoring') {
      return { text: 'Принять счёт', onClick: store.acceptScore, enabled: !iAccepted };
    }
    return null;
  }, [store.status, store.acceptScore, canConfirm, iAccepted, roomId, confirmMove]);

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

  const active = store.settings ?? settings;
  const board = store.game?.board ?? new Uint8Array(active.size * active.size);
  const running = store.status === 'playing' && store.game ? seatOf(store.game.toPlay) : null;

  return (
    <div className="screen">
      <header className="status">
        <div className="status-main">{headline(store, myTurn)}</div>
        <div className="status-sub">
          {store.notice ? (
            <span className="status-warn">{store.notice}</span>
          ) : (
            subline(store, accepted)
          )}
        </div>
        {store.clock && (
          <Clocks
            clock={store.clock}
            time={active.time}
            running={running}
            yourColor={store.yourColor}
          />
        )}
      </header>

      <Board
        size={active.size}
        dark={isDark}
        board={board}
        lastMove={store.lastMove}
        pending={store.pending}
        pendingColor={engineColorOf(store.yourColor ?? 'black')}
        rejected={store.rejected}
        dead={dead}
        owners={owners}
        onTapPoint={store.status === 'scoring' ? toggleDead : aim}
        onTapOutside={clearAim}
      />

      <footer className="actions">
        {store.status === 'playing' && (
          <>
            {!hasNativeButtons() && (
              <Button size="l" stretched disabled={!canConfirm} onClick={confirmMove}>
                Подтвердить ход
              </Button>
            )}
            <div className="actions-row">
              <Button
                size="m"
                mode="outline"
                stretched
                disabled={!myTurn}
                onClick={() => void doPass()}
              >
                Пас
              </Button>
              <Button size="m" mode="outline" stretched onClick={() => void doResign()}>
                Сдаться
              </Button>
            </div>
          </>
        )}

        {store.status === 'scoring' && (
          <>
            {!hasNativeButtons() && (
              <Button size="l" stretched disabled={iAccepted} onClick={store.acceptScore}>
                {iAccepted ? 'Ждём соперника' : 'Принять счёт'}
              </Button>
            )}
            <Button size="m" mode="outline" stretched onClick={store.resumeGame}>
              Доиграть
            </Button>
          </>
        )}

        {store.status === 'finished' && (
          <Button size="l" stretched onClick={() => void exit()}>
            В лобби
          </Button>
        )}
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
  return (
    <div className="screen screen-scroll">
      <header className="status">
        <div className="status-main">Ждём соперника</div>
        <div className="status-sub">{connectionText(connection)}</div>
      </header>

      <Section
        header="Партия"
        footer="Отправьте ссылку другу: кто откроет её первым, тот и сядет за доску."
      >
        <Cell subtitle="Доска">
          {settings.size}×{settings.size}
        </Cell>
        <Cell subtitle="Коми">{settings.komi}</Cell>
        <Cell subtitle="Фора">{settings.handicap === 0 ? 'нет' : settings.handicap}</Cell>
        <Cell subtitle="Время">{timeControlText(settings)}</Cell>
        <Cell subtitle="Вы играете">{yourColor ? colorWord(yourColor) : '—'}</Cell>
      </Section>

      <Section header="Ссылка">
        <div className="invite-link mono">{inviteLink(roomId)}</div>
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

type Store = ReturnType<typeof useOnlineStore.getState>;

function headline(store: Store, myTurn: boolean): string {
  if (store.status === 'finished') return resultText(store.result);
  if (store.status === 'scoring') return 'Отметьте мёртвые камни';
  if (!store.game) return 'Открываем комнату…';
  return myTurn ? 'Ваш ход' : 'Ход соперника';
}

function subline(store: Store, accepted: SeatColor[]): string {
  if (store.connection !== 'online') return connectionText(store.connection);

  if (store.status === 'scoring') {
    if (accepted.length === 0) return 'Тапните по мёртвой группе, потом примите счёт';
    if (store.yourColor && accepted.includes(store.yourColor)) return 'Ждём соперника';
    return 'Соперник принял счёт';
  }

  if (store.status === 'finished' && store.score) {
    return `Чёрные ${store.score.black} : ${store.score.white} белые`;
  }

  return opponentText(store.seats, store.online, store.yourColor);
}

function opponentText(seats: Seat[], online: SeatColor[], yourColor: SeatColor | null): string {
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

function resultText(result: string | null): string {
  if (!result) return 'Партия окончена';
  if (result === 'Draw') return 'Ничья';
  const [side, margin] = result.split('+');
  const who = side === 'B' ? 'Чёрные' : 'Белые';
  if (margin === 'R') return `${who} выиграли: сдача`;
  if (margin === 'T') return `${who} выиграли по времени`;
  return `${who} выиграли +${margin}`;
}

export function timeControlText(settings: GameSettings): string {
  const time = settings.time;
  switch (time.type) {
    case 'none':
      return 'без часов';
    case 'fischer':
      return `${Math.round(time.mainMs / 60000)} мин + ${Math.round(time.incrementMs / 1000)} с`;
    case 'byoyomi':
      return `${Math.round(time.mainMs / 60000)} мин + ${time.periods}×${Math.round(
        time.periodMs / 1000,
      )} с`;
  }
}

function colorWord(color: SeatColor): string {
  return color === 'black' ? 'чёрными' : 'белыми';
}
