import { isTMA, mockTelegramEnv } from '@telegram-apps/sdk-react';

/**
 * Вне Telegram launch params взять неоткуда, и SDK падает на старте.
 * В dev-сборке подменяем окружение, чтобы страницу можно было открыть
 * в обычном браузере. В прод-бандл эта ветка не попадает.
 */
export function mockEnvIfOutsideTelegram(): void {
  if (!import.meta.env.DEV || isTMA()) return;

  const initDataRaw = new URLSearchParams({
    user: JSON.stringify({
      id: 1,
      first_name: 'Локальный',
      last_name: 'Игрок',
      username: 'local',
      language_code: 'ru',
      allows_write_to_pm: true,
    }),
    auth_date: Math.floor(Date.now() / 1000).toString(),
    signature: 'mock-signature',
    hash: 'mock-hash',
  }).toString();

  mockTelegramEnv({
    launchParams: new URLSearchParams({
      tgWebAppData: initDataRaw,
      tgWebAppVersion: '8.0',
      tgWebAppPlatform: 'tdesktop',
      tgWebAppThemeParams: JSON.stringify({
        bg_color: '#ffffff',
        text_color: '#000000',
        hint_color: '#707579',
        link_color: '#3390ec',
        button_color: '#3390ec',
        button_text_color: '#ffffff',
        secondary_bg_color: '#f4f4f5',
      }),
    }),
  });

  console.info('[telegram] окружение замокано: приложение открыто вне Telegram');
}
