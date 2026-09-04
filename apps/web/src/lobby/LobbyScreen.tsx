import { defaultKomi } from '@go/engine';
import type { GameSettings } from '@go/protocol';
import { Button, Cell, List, Section } from '@telegram-apps/telegram-ui';
import { useState } from 'react';
import { createRoom } from '../api/room.js';
import { BOARD_SIZES, HANDICAPS, useGameStore } from '../game/store.js';

const COLORS = [
  { value: 'black', label: 'Чёрные' },
  { value: 'white', label: 'Белые' },
  { value: 'random', label: 'Жребий' },
] as const;

export interface LobbyScreenProps {
  onCreated: (roomId: string, settings: GameSettings) => void;
}

export function LobbyScreen({ onCreated }: LobbyScreenProps) {
  const [size, setSize] = useState<9 | 13 | 19>(9);
  const [handicap, setHandicap] = useState(0);
  const [creatorColor, setCreatorColor] = useState<GameSettings['creatorColor']>('random');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startHotseat = useGameStore((state) => state.start);

  const settings: GameSettings = {
    size,
    handicap,
    komi: defaultKomi(size, handicap),
    creatorColor,
  };

  const invite = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom(settings);
      onCreated(room.roomId, room.settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

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

      <Section header="Ваш цвет">
        <div className="choice-row">
          {COLORS.map((option) => (
            <Button
              key={option.value}
              size="m"
              mode={option.value === creatorColor ? 'filled' : 'outline'}
              onClick={() => setCreatorColor(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </Section>

      <Section header="Партия">
        <Cell subtitle="Коми">{settings.komi}</Cell>
        <Cell subtitle="Правила">Китайские, позиционный суперко</Cell>
      </Section>

      {error && (
        <Section header="Не вышло">
          <Cell subtitle="Комната">{error}</Cell>
        </Section>
      )}

      <div className="lobby-start">
        <Button size="l" stretched loading={busy} onClick={() => void invite()}>
          Пригласить друга
        </Button>
        <Button
          size="l"
          mode="outline"
          stretched
          onClick={() => startHotseat({ size, handicap, komi: settings.komi })}
        >
          На одном устройстве
        </Button>
      </div>
    </List>
  );
}
