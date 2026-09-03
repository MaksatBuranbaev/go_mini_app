import '@telegram-apps/telegram-ui/dist/styles.css';
import './index.css';

import { AppRoot } from '@telegram-apps/telegram-ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { randomRoomId } from './api/room.js';
import { initTelegram, startParam } from './telegram/init.js';
import { useRoomStore } from './store/room.js';

const root = createRoot(document.getElementById('root')!);

function fail(message: string): void {
  root.render(
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h2>Не удалось запустить</h2>
      <p>{message}</p>
      <p>Откройте приложение из Telegram.</p>
    </div>,
  );
}

initTelegram().then(
  () => {
    // Без deep link генерируем комнату сами — иначе пинговать нечего.
    useRoomStore.getState().setRoomId(startParam() ?? randomRoomId());
    root.render(
      <StrictMode>
        <AppRoot>
          <App />
        </AppRoot>
      </StrictMode>,
    );
  },
  (e: unknown) => fail(e instanceof Error ? e.message : String(e)),
);
