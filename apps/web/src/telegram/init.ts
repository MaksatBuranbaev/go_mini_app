import {
  backButton,
  init as initSDK,
  mainButton,
  miniApp,
  restoreInitData,
  retrieveLaunchParams,
  swipeBehavior,
  themeParams,
  viewport,
} from '@telegram-apps/sdk-react';
import { mockEnvIfOutsideTelegram } from './mockEnv.js';

/**
 * Поднимает SDK и монтирует то, что нужно доске.
 *
 * Каждый компонент проверяется на доступность: версии клиентов Telegram
 * различаются, и вызов неподдержанного метода — исключение, а не no-op.
 */
export function initTelegram(): void {
  mockEnvIfOutsideTelegram();
  initSDK();

  // init() сигналы initData не наполняет — их поднимает только restore.
  // Без этого initDataUser и остальные значения молча остаются пустыми.
  restoreInitData();

  if (miniApp.mountSync.isAvailable()) {
    miniApp.mountSync();
    miniApp.bindCssVars();
  }
  if (themeParams.mountSync.isAvailable()) {
    themeParams.mountSync();
    themeParams.bindCssVars();
  }
  if (backButton.isSupported()) {
    backButton.mount();
  }
  // MainButton монтируется здесь один раз: экраны только меняют её надпись.
  if (mainButton.mount.isAvailable()) {
    mainButton.mount();
  }
  // Без этого вертикальный свайп по доске сворачивает приложение.
  if (swipeBehavior.mount.isAvailable()) {
    swipeBehavior.mount();
    if (swipeBehavior.disableVertical.isAvailable()) {
      swipeBehavior.disableVertical();
    }
  }

  // Вьюпорт монтируется запросом к клиенту Telegram и ждёт ответа. Ждать его
  // до первого кадра нельзя: не пришёл ответ — приложение не отрисовалось бы
  // вовсе. Переменные вьюпорта привяжутся, когда данные доедут; до тех пор
  // вёрстка живёт на запасных значениях из index.css.
  if (viewport.mount.isAvailable() && !viewport.isMounting()) {
    viewport
      .mount()
      .then(() => viewport.bindCssVars())
      .catch((error: unknown) => console.warn('[telegram] вьюпорт не смонтировался', error));
  }

  miniApp.ready();
}

/** start_param из deep link `t.me/<bot>/<app>?startapp=<roomId>`. */
export function startParam(): string | undefined {
  try {
    return retrieveLaunchParams(true).tgWebAppStartParam;
  } catch {
    return undefined;
  }
}
