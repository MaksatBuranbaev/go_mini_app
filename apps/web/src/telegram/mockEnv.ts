import { emitEvent, mockTelegramEnv } from '@telegram-apps/sdk-react';

const THEME = {
  bg_color: '#ffffff',
  text_color: '#000000',
  hint_color: '#707579',
  link_color: '#3390ec',
  button_color: '#3390ec',
  button_text_color: '#ffffff',
  secondary_bg_color: '#f4f4f5',
  section_bg_color: '#ffffff',
  header_bg_color: '#ffffff',
  accent_text_color: '#3390ec',
  section_header_text_color: '#707579',
  subtitle_text_color: '#707579',
  destructive_text_color: '#df3f40',
  // as const: SDK ждёт цвета типом `#${string}`, а не просто string.
} as const;

let mocked = false;

/**
 * Правда ли, что окружение подменено. Отличается от «SDK считает метод
 * доступным»: мок отвечает на запросы, но нативных кнопок клиента за ним нет,
 * и экраны должны рисовать свои.
 */
export function isMockedEnv(): boolean {
  return mocked;
}

/**
 * Признак настоящего клиента Telegram: мобильный вставляет `TelegramWebviewProxy`,
 * веб-версия открывает мини-апп во фрейме.
 *
 * Именно так, а не через `isTMA()`: тот считает окружение телеграмным, если
 * найдёт launch params, — а их туда кладёт сам мок. После первой же
 * перезагрузки страницы мок переставал применяться, и обработчик событий
 * не ставился: запросы к «клиенту» уходили в никуда.
 */
function insideTelegramClient(): boolean {
  return (
    typeof (window as { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy !== 'undefined' ||
    window.parent !== window
  );
}

/**
 * Вне Telegram launch params взять неоткуда, и SDK падает на старте.
 * В dev-сборке подменяем окружение, чтобы доску можно было открыть
 * в обычном браузере. В прод-бандл эта ветка не попадает.
 */
export function mockEnvIfOutsideTelegram(): void {
  if (!import.meta.env.DEV || insideTelegramClient()) return;

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
      tgWebAppThemeParams: JSON.stringify(THEME),
    }),
    // Запросы к клиенту нужно не только принять, но и ответить на них:
    // без ответа монтирование вьюпорта висит вечно, а вместе с ним и вёрстка.
    onEvent([method], next) {
      switch (method) {
        case 'web_app_request_theme':
          return emitEvent('theme_changed', { theme_params: THEME });
        case 'web_app_request_viewport':
          return emitEvent('viewport_changed', {
            height: window.innerHeight,
            width: window.innerWidth,
            is_expanded: true,
            is_state_stable: true,
          });
        case 'web_app_request_safe_area':
          return emitEvent('safe_area_changed', { left: 0, top: 0, right: 0, bottom: 0 });
        case 'web_app_request_content_safe_area':
          return emitEvent('content_safe_area_changed', { left: 0, top: 0, right: 0, bottom: 0 });
        default:
          return next();
      }
    },
  });

  mocked = true;
  console.info('[telegram] окружение замокано: приложение открыто вне Telegram');
}
