import { defaultKomi } from '@go/engine';
import type { GameSettings, ScoringRules, TimeControl } from '@go/protocol';
import { Button, Cell, List, Section } from '@telegram-apps/telegram-ui';
import { useState } from 'react';
import { createRoom } from '../api/room.js';
import { BOARD_SIZES, HANDICAPS, useGameStore } from '../game/store.js';
import { isSoundEnabled, setSoundEnabled } from '../telegram/sound.js';
import { TIME_PRESETS, controlText, lengthText } from './time.js';

const COLORS = [
  { value: 'black', label: 'Чёрные' },
  { value: 'white', label: 'Белые' },
  { value: 'random', label: 'Жребий' },
] as const;

const RULES: { value: ScoringRules; label: string; hint: string }[] = [
  { value: 'chinese', label: 'Китайские', hint: 'Камни на доске плюс территория' },
  { value: 'japanese', label: 'Японские', hint: 'Территория плюс пленные' },
];

export interface LobbyScreenProps {
  onCreated: (roomId: string, settings: GameSettings) => void;
  onArchive: () => void;
}

export function LobbyScreen({ onCreated, onArchive }: LobbyScreenProps) {
  const [size, setSize] = useState<9 | 13 | 19>(9);
  const [handicap, setHandicap] = useState(0);
  const [creatorColor, setCreatorColor] = useState<GameSettings['creatorColor']>('random');
  const [rules, setRules] = useState<ScoringRules>('chinese');
  // `null` — коми считается автоматически. Как только игрок тронул его руками,
  // автоподстановка выключается: иначе смена доски молча затрёт выбор.
  const [komi, setKomi] = useState<number | null>(null);
  const [timeIndex, setTimeIndex] = useState(1);
  const [sound, setSound] = useState(isSoundEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startHotseat = useGameStore((state) => state.start);

  const autoKomi = defaultKomi(size, handicap, rules);
  const effectiveKomi = komi ?? autoKomi;

  const settings: GameSettings = {
    size,
    handicap,
    komi: effectiveKomi,
    creatorColor,
    time: TIME_PRESETS[timeIndex]!,
    rules,
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
    <div className="screen screen-scroll lobby">
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

        <Section
          header="Правила"
          footer={RULES.find((option) => option.value === rules)!.hint}
        >
          <div className="choice-row">
            {RULES.map((option) => (
              <Button
                key={option.value}
                size="m"
                mode={option.value === rules ? 'filled' : 'outline'}
                onClick={() => setRules(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </Section>

        <Section header="Коми" footer="Компенсация белым за то, что чёрные ходят первыми.">
          <div className="stepper">
            <Button size="s" mode="outline" onClick={() => setKomi(clampKomi(effectiveKomi - 0.5))}>
              −
            </Button>
            <span className="stepper-value">
              {effectiveKomi}
              {komi === null && <span className="stepper-note">авто</span>}
            </span>
            <Button size="s" mode="outline" onClick={() => setKomi(clampKomi(effectiveKomi + 0.5))}>
              +
            </Button>
            {komi !== null && (
              <Button size="s" mode="plain" onClick={() => setKomi(null)}>
                сбросить
              </Button>
            )}
          </div>
        </Section>

        <Section header="Время">
          <div className="time-presets">
            {TIME_PRESETS.map((preset, index) => (
              <button
                key={index}
                type="button"
                className={`time-preset${index === timeIndex ? ' time-preset-on' : ''}`}
                onClick={() => setTimeIndex(index)}
              >
                <span className="time-preset-length">{lengthText(preset, size)}</span>
                <span className="time-preset-value">{controlText(preset)}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section header="Партия">
          <Cell
            subtitle="Стук камня о доску"
            after={
              <Button
                size="s"
                mode={sound ? 'filled' : 'outline'}
                onClick={() => {
                  setSoundEnabled(!sound);
                  setSound(!sound);
                }}
              >
                {sound ? 'вкл' : 'выкл'}
              </Button>
            }
          >
            Звук
          </Cell>
          <Cell subtitle="Ко">Позиционный суперко</Cell>
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
            onClick={() => startHotseat({ size, handicap, komi: effectiveKomi, rules })}
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

function clampKomi(value: number): number {
  return Math.min(10, Math.max(-10, Math.round(value * 2) / 2));
}
