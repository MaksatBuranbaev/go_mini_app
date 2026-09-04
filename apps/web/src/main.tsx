import '@telegram-apps/telegram-ui/dist/styles.css';
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { Themed } from './telegram/Themed.js';
import { initTelegram } from './telegram/init.js';
import { mockEnvIfOutsideTelegram } from './telegram/mockEnv.js';

const root = createRoot(document.getElementById('root')!);

function fail(error: unknown): void {
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

// Подмена окружения асинхронна: initData подписывается через Web Crypto.
// В прод-сборке эта ветка вырезана и промис резолвится тем же тиком, так что
// ждать здесь нечего — но обещание всё равно должно быть с обработчиком
// ошибки, иначе отказ оставил бы пустую страницу.
mockEnvIfOutsideTelegram().then(() => {
  try {
    initTelegram();
    root.render(
      <StrictMode>
        <Themed>
          <App />
        </Themed>
      </StrictMode>,
    );
  } catch (error) {
    fail(error);
  }
}, fail);
