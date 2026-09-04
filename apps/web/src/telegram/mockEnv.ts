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

/**
 * Тот же фальшивый токен, что в `apps/room/.dev.vars` (см. `.dev.vars.example`).
 * Настоящий токен бота живёт только в секретах Worker'а и сюда не попадает
 * никогда: этой веткой кода распоряжается `import.meta.env.DEV`.
 */
const DEV_BOT_TOKEN =
  import.meta.env.VITE_DEV_BOT_TOKEN ?? '1234567890:TEST_TOKEN_FOR_LOCAL_DEV_ONLY';

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
 *
 * initData подписывается по-настоящему, локальным токеном: комната проверяет
 * подпись без всяких послаблений, и обходного пути в ней нет — иначе такой
 * обход рано или поздно уехал бы в прод.
 */
export async function mockEnvIfOutsideTelegram(): Promise<void> {
  if (!import.meta.env.DEV || insideTelegramClient()) return;

  const initDataRaw = await signInitData(
    {
      user: JSON.stringify({
        id: devUserId(),
        first_name: devUserName(),
        username: `local${devUserId()}`,
        language_code: 'ru',
        allows_write_to_pm: true,
      }),
      auth_date: Math.floor(Date.now() / 1000).toString(),
      signature: 'mock-signature',
    },
    DEV_BOT_TOKEN,
  );

  mockTelegramEnv({
    launchParams: new URLSearchParams({
      tgWebAppData: initDataRaw,
      tgWebAppVersion: '8.0',
      tgWebAppPlatform: 'tdesktop',
      tgWebAppThemeParams: JSON.stringify(THEME),
      ...startParamFromUrl(),
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
  console.info('[telegram] окружение замокано, пользователь', devUserId());
}

/**
 * Два игрока за одной машиной — это две вкладки, и Telegram-id у них обязан
 * различаться, иначе комната посадит обоих на одно место. Задаётся `?dev_user=`.
 */
function devUserId(): number {
  const raw = new URLSearchParams(window.location.search).get('dev_user');
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function devUserName(): string {
  return `Игрок ${devUserId()}`;
}

/** В браузере deep link имитируется параметром `?startapp=`. */
function startParamFromUrl(): Record<string, string> {
  const value = new URLSearchParams(window.location.search).get('startapp');
  return value ? { tgWebAppStartParam: value } : {};
}

/**
 * Подпись initData по схеме Telegram: ключ выводится из токена бота,
 * данные склеиваются отсортированными парами `key=value` через перевод строки.
 */
async function signInitData(params: Record<string, string>, token: string): Promise<string> {
  const pairs = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1));
  const dataCheckString = pairs.map(([key, value]) => `${key}=${value}`).join('\n');

  const secret = await hmac(new TextEncoder().encode('WebAppData'), token);
  const signature = await hmac(secret, dataCheckString);

  return new URLSearchParams([...pairs, ['hash', hex(signature)]]).toString();
}

async function hmac(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', imported, new TextEncoder().encode(message));
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
