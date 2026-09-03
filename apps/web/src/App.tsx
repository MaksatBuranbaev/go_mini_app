import { useSignal } from '@telegram-apps/sdk-react';
import { initDataUser, isMiniAppDark } from '@telegram-apps/sdk-react';
import {
  Button,
  Caption,
  Cell,
  List,
  Placeholder,
  Section,
} from '@telegram-apps/telegram-ui';
import { useEffect } from 'react';
import { roomBaseUrl } from './api/room.js';
import { useRoomStore } from './store/room.js';

/**
 * Экран фазы 0. Игры здесь нет: он показывает, что мини-апп поднялся внутри
 * Telegram, увидел start_param и достучался до своей комнаты.
 */
export function App() {
  const user = useSignal(initDataUser);
  const isDark = useSignal(isMiniAppDark);
  const { roomId, status, pong, error, ping } = useRoomStore();

  useEffect(() => {
    void ping();
  }, [ping]);

  return (
    <List>
      <Placeholder header="Го" description="Каркас поднят. Доски пока нет — это фаза 2." />

      <Section header="Telegram">
        <Cell subtitle="Пользователь">
          {user ? `${user.first_name} ${user.last_name ?? ''}`.trim() : '—'}
        </Cell>
        <Cell subtitle="Тема">{isDark ? 'тёмная' : 'светлая'}</Cell>
      </Section>

      <Section
        header="Комната"
        footer={
          <Caption className="mono">
            {roomBaseUrl()}
          </Caption>
        }
      >
        <Cell subtitle="id из start_param">
          <span className="mono">{roomId || '—'}</span>
        </Cell>
        <Cell subtitle="Статус">
          {status === 'pinging' && 'пингую…'}
          {status === 'ok' && pong && `жива, пингов: ${pong.pings}`}
          {status === 'error' && (error ?? 'ошибка')}
          {status === 'idle' && '—'}
        </Cell>
        {pong && (
          <Cell subtitle="Создана">
            {new Date(pong.createdAt).toLocaleString('ru-RU')}
          </Cell>
        )}
      </Section>

      <div style={{ padding: 16 }}>
        <Button stretched loading={status === 'pinging'} onClick={() => void ping()}>
          Пингануть комнату
        </Button>
      </div>
    </List>
  );
}
