import type { GameSettings, RoomPreview, SeatColor } from '@go/protocol';
import { Button, Cell, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchRoomPreview } from '../api/room.js';
import { hasNativeButtons, useBackButton, useMainButton } from '../telegram/buttons.js';
import { timeControlText } from './RoomScreen.js';

export interface JoinScreenProps {
  roomId: string;
  /** Второй аргумент — место, которое комната обещала на момент превью. */
  onAccept: (settings: GameSettings, expected: SeatColor | null) => void;
  onCancel: () => void;
}

/**
 * Экран по ссылке-приглашению: сначала показываем настройки партии и только
 * потом сажаем за доску. Место занимается соединением, а не открытием ссылки, —
 * иначе случайный переход по ссылке съедал бы второе место в комнате.
 */
export function JoinScreen({ roomId, onAccept, onCancel }: JoinScreenProps) {
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRoomPreview(roomId).then(
      (result) => {
        if (!cancelled) setPreview(result);
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const accept = useCallback(() => {
    if (preview) onAccept(preview.settings, preview.yourColor);
  }, [preview, onAccept]);

  useBackButton(onCancel);
  useMainButton(
    useMemo(
      () =>
        preview
          ? { text: preview.yourColor ? 'Принять' : 'Смотреть партию', onClick: accept }
          : null,
      [preview, accept],
    ),
  );

  if (error) {
    return (
      <Placeholder header="Комната недоступна" description={error}>
        <Button size="l" onClick={onCancel}>
          В лобби
        </Button>
      </Placeholder>
    );
  }

  if (!preview) {
    return (
      <Placeholder header="Приглашение" description="Смотрим, что за партия…">
        <Spinner size="m" />
      </Placeholder>
    );
  }

  const full = preview.yourColor === null;

  return (
    <div className="screen screen-scroll">
      <header className="status">
        <div className="status-main">Приглашение в партию</div>
        <div className="status-sub">
          {full
            ? 'Мест за доской нет — можно смотреть со стороны'
            : `Вы сядете ${colorWord(preview.yourColor!)}`}
        </div>
      </header>

      <Section header="Партия">
        <Cell subtitle="Доска">
          {preview.settings.size}×{preview.settings.size}
        </Cell>
        <Cell subtitle="Коми">{preview.settings.komi}</Cell>
        <Cell subtitle="Фора">
          {preview.settings.handicap === 0 ? 'нет' : preview.settings.handicap}
        </Cell>
        <Cell subtitle="Время">{timeControlText(preview.settings)}</Cell>
        <Cell subtitle="Правила">Китайские, позиционный суперко</Cell>
      </Section>

      <Section header="За доской">
        {preview.seats.length === 0 ? (
          <Cell subtitle="Пока никого">—</Cell>
        ) : (
          preview.seats.map((seat) => (
            <Cell key={seat.color} subtitle={colorWord(seat.color)}>
              {seat.name}
            </Cell>
          ))
        )}
      </Section>

      <footer className="actions">
        {!hasNativeButtons() && (
          <Button size="l" stretched onClick={accept}>
            {full ? 'Смотреть партию' : 'Принять'}
          </Button>
        )}
        <Button size="l" mode="outline" stretched onClick={onCancel}>
          {full ? 'В лобби' : 'Отказаться'}
        </Button>
      </footer>
    </div>
  );
}

function colorWord(color: 'black' | 'white'): string {
  return color === 'black' ? 'чёрными' : 'белыми';
}
