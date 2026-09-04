import { hapticFeedback, popup } from '@telegram-apps/sdk-react';
import { isMockedEnv } from './mockEnv.js';
import { captureSound, stoneSound } from './sound.js';

/** Наметили точку: самый лёгкий отклик, он повторяется чаще всех. */
export function aimFeedback(): void {
  if (hapticFeedback.selectionChanged.isAvailable()) hapticFeedback.selectionChanged();
}

/** Камень встал на доску. */
export function stoneFeedback(): void {
  if (hapticFeedback.impactOccurred.isAvailable()) hapticFeedback.impactOccurred('medium');
  stoneSound();
}

/** Взяли группу — отклик заметно сильнее обычного хода. */
export function captureFeedback(): void {
  if (hapticFeedback.impactOccurred.isAvailable()) hapticFeedback.impactOccurred('heavy');
  captureSound();
}

/** Ход отвергнут правилами. */
export function rejectFeedback(): void {
  if (hapticFeedback.notificationOccurred.isAvailable()) {
    hapticFeedback.notificationOccurred('error');
  }
}

/**
 * Подтверждение необратимого действия. Вне Telegram (и в старых клиентах,
 * где попапов нет) откатывается на браузерный confirm, чтобы поток не вставал:
 * нативный попап ждёт ответа клиента, и за моком это ожидание вечное.
 */
export async function confirmAction(message: string, confirmText: string): Promise<boolean> {
  if (popup.show.isAvailable() && !isMockedEnv()) {
    const pressed = await popup.show({
      message,
      buttons: [
        { id: 'confirm', type: 'destructive', text: confirmText },
        { id: 'cancel', type: 'cancel' },
      ],
    });
    return pressed === 'confirm';
  }
  return window.confirm(message);
}
