import { defaultKomi } from '@go/engine';
import type { GameSettings, TimeControl } from '@go/protocol';
import { Button, Cell, List, Section } from '@telegram-apps/telegram-ui';
import { useState } from 'react';
import { createRoom } from '../api/room.js';
import { BOARD_SIZES, HANDICAPS, useGameStore } from '../game/store.js';

/**
 * Готовые контроли времени вместо полного редактора: в лобби для друзей
 * важнее сделать выбор в один тап, чем задать любые мыслимые настройки.
 */
const TIME_PRESETS: { label: string; value: TimeControl }[] = [
  { label: 'Без часов', value: { type: 'none' } },
  { label: 'Блиц 5+5', value: { type: 'fischer', mainMs: 300_000, incrementMs: 5_000 } },
  { label: 'Фишер 10+10', value: { type: 'fischer', mainMs: 600_000, incrementMs: 10_000 } },
  {
    label: 'Бёёми 10 + 3×30',
    value: { type: 'byoyomi', mainMs: 600_000, periodMs: 30_000, periods: 3 },
  },
];

const COLORS = [
  { value: 'black', label: 'Чёрные' },
  { value: 'white', label: 'Белые' },
  { value: 'random', label: 'Жребий' },
] as const;

export interface LobbyScreenProps {
  onCreated: (roomId: string, settings: GameSettings) => void;
  onArchive: () => void;
}

export function LobbyScreen({ onCreated, onArchive }: LobbyScreenProps) {
  const [size, setSize] = useState<9 | 13 | 19>(9);
  const [handicap, setHandicap] = useState(0);
  const [creatorColor, setCreatorColor] = useState<GameSettings['creatorColor']>('random');
  const [timeIndex, setTimeIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startHotseat = useGameStore((state) => state.start);

  const settings: GameSettings = {
    size,
    handicap,
    komi: defaultKomi(size, handicap),
    creatorColor,
    time: TIME_PRESETS[timeIndex]!.value,
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
    // Высота #root задана переменной вьюпорта, поэтому лобби прокручивается
    // само: полагаться на прокрутку документа в WebView нельзя.
    <div className="screen screen-scroll">
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

        <Section header="Время">
          <div className="choice-row choice-wrap">
            {TIME_PRESETS.map((preset, index) => (
              <Button
                key={preset.label}
                size="s"
                mode={index === timeIndex ? 'filled' : 'outline'}
                onClick={() => setTimeIndex(index)}
              >
                {preset.label}
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
          <Button size="m" mode="plain" stretched onClick={onArchive}>
            Мои партии
          </Button>
        </div>
      </List>
    </div>
  );
}
