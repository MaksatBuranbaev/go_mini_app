import { Button, Caption, Cell, List, Section } from '@telegram-apps/telegram-ui';
import { useState } from 'react';
import { roomBaseUrl } from '../api/room.js';
import { BOARD_SIZES, HANDICAPS, settingsFor, useGameStore } from '../game/store.js';
import { useRoomStore } from '../store/room.js';

/**
 * Лобби фазы 2: партия идёт на одном устройстве, поэтому из настроек здесь
 * только то, что меняет саму доску. Цвет, время и приглашение появятся
 * вместе с живой комнатой.
 */
export function LobbyScreen() {
  const [size, setSize] = useState(9);
  const [handicap, setHandicap] = useState(0);
  const start = useGameStore((state) => state.start);
  const { roomId, status, pong } = useRoomStore();

  const settings = settingsFor(size, handicap);

  return (
    <List>
      <Section header="Размер доски">
        <div className="choice-row">
          {BOARD_SIZES.map((option) => (
            <Button
              key={option}
              size="m"
              mode={option === size ? 'filled' : 'outline'}
              onClick={() => setSize(option)}
            >
              {option}×{option}
            </Button>
          ))}
        </div>
      </Section>

      <Section header="Фора" footer="Чёрные получают камни на хоси, первый ход за белыми.">
        <div className="choice-row choice-wrap">
          {HANDICAPS.map((option) => (
            <Button
              key={option}
              size="s"
              mode={option === handicap ? 'filled' : 'outline'}
              onClick={() => setHandicap(option)}
            >
              {option === 0 ? 'нет' : option}
            </Button>
          ))}
        </div>
      </Section>

      <Section header="Партия">
        <Cell subtitle="Коми">{settings.komi}</Cell>
        <Cell subtitle="Правила">Китайские, позиционный суперко</Cell>
        <Cell subtitle="Режим">Вдвоём на одном устройстве</Cell>
      </Section>

      <div className="lobby-start">
        <Button size="l" stretched onClick={() => start(settings)}>
          Начать партию
        </Button>
      </div>

      <Section header="Комната">
        <Cell subtitle="id">
          <span className="mono">{roomId || '—'}</span>
        </Cell>
        <Cell subtitle="Состояние">
          {status === 'ok' && pong ? `отвечает, пингов: ${pong.pings}` : status}
        </Cell>
        <Caption className="mono lobby-room-url">{roomBaseUrl()}</Caption>
      </Section>
    </List>
  );
}
