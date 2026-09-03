import '@telegram-apps/telegram-ui/dist/styles.css';
import './index.css';

import { AppRoot } from '@telegram-apps/telegram-ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { randomRoomId } from './api/room.js';
import { useRoomStore } from './store/room.js';
import { initTelegram, startParam } from './telegram/init.js';

const root = createRoot(document.getElementById('root')!);

try {
  initTelegram();
  // Без deep link генерируем комнату сами — иначе пинговать нечего.
  useRoomStore.getState().setRoomId(startParam() ?? randomRoomId());

  root.render(
    <StrictMode>
      <AppRoot style={{ height: '100%' }}>
        <App />
      </AppRoot>
    </StrictMode>,
  );
} catch (error) {
  // Внутри Telegram консоль недоступна глазами, но она есть в логах WebView
  // и в отладке через desktop-клиент — это единственный след причины.
  console.error('[go] старт не удался', error);
  root.render(
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h2>Не удалось запустить</h2>
      <p>{error instanceof Error ? error.message : String(error)}</p>
      <p>Откройте приложение из Telegram.</p>
    </div>,
  );
}
