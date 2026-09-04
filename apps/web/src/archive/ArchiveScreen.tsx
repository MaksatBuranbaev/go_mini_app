import { Button, Cell, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useMemo, useState } from 'react';
import { useBackButton } from '../telegram/buttons.js';
import { listGames, type ArchivedGame } from './storage.js';

export interface ArchiveScreenProps {
  onOpen: (id: string) => void;
  onBack: () => void;
}

/** Список сыгранных партий: сначала свежие. */
export function ArchiveScreen({ onOpen, onBack }: ArchiveScreenProps) {
  const [games, setGames] = useState<ArchivedGame[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listGames().then(
      (list) => {
        if (!cancelled) setGames(list);
      },
      () => {
        if (!cancelled) setGames([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useBackButton(useMemo(() => onBack, [onBack]));

  if (games === null) {
    return (
      <Placeholder header="Мои партии" description="Открываем архив…">
        <Spinner size="m" />
      </Placeholder>
    );
  }

  if (games.length === 0) {
    return (
      <Placeholder
        header="Партий пока нет"
        description="Сыгранные партии сохраняются сюда и синхронизируются между вашими устройствами Telegram."
      >
        <Button size="l" onClick={onBack}>
          В лобби
        </Button>
      </Placeholder>
    );
  }

  return (
    <div className="screen screen-scroll">
      <header className="status">
        <div className="status-main">Мои партии</div>
        <div className="status-sub">Тапните по партии, чтобы посмотреть её по ходам</div>
      </header>

      <Section footer="Архив хранится у вас в Telegram, не на сервере.">
        {games.map((game) => (
          <Cell
            key={game.id}
            subtitle={`${dateText(game.at)} · ${game.size}×${game.size} · ${moveCount(game.moves)}`}
            onClick={() => onOpen(game.id)}
          >
            {resultText(game.result)}
          </Cell>
        ))}
      </Section>

      <footer className="actions">
        <Button size="l" mode="outline" stretched onClick={onBack}>
          В лобби
        </Button>
      </footer>
    </div>
  );
}

/** «1 ход», «2 хода», «11 ходов» — иначе список читается как черновик. */
function moveCount(moves: number): string {
  const tail = moves % 100 >= 11 && moves % 100 <= 14 ? 'ходов' : ['ходов', 'ход', 'хода', 'хода', 'хода'][moves % 10] ?? 'ходов';
  return `${moves} ${tail}`;
}

export function dateText(at: number): string {
  return new Date(at).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function resultText(result: string | null): string {
  if (!result) return 'Партия не доиграна';
  if (result === 'Draw') return 'Ничья';
  const [side, margin] = result.split('+');
  const who = side === 'B' ? 'Чёрные' : 'Белые';
  if (margin === 'R') return `${who} выиграли: сдача`;
  if (margin === 'T') return `${who} выиграли: время`;
  return `${who} выиграли +${margin}`;
}
