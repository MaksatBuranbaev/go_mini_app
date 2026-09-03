import {
  backButton,
  init as initSDK,
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
export async function initTelegram(): Promise<void> {
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
  // Без этого вертикальный свайп по доске сворачивает приложение.
  if (swipeBehavior.mount.isAvailable()) {
    swipeBehavior.mount();
    if (swipeBehavior.disableVertical.isAvailable()) {
      swipeBehavior.disableVertical();
    }
  }
  if (viewport.mount.isAvailable() && !viewport.isMounting()) {
    await viewport.mount();
    viewport.bindCssVars();
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
