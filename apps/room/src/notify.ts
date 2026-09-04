/**
 * Уведомление «ваш ход» через Bot API.
 *
 * Бот пишет только тем, кто хоть раз его запускал; остальным Telegram отвечает
 * 403, и это штатный исход, а не сбой — глушим и живём дальше. Ошибку наружу
 * не поднимаем вовсе: ход уже сделан и записан, и падать из-за недоставленного
 * уведомления комнате незачем.
 */
export async function notifyTurn(
  env: Env,
  options: { userId: number; roomId: string; opponentName: string },
): Promise<void> {
  if (!env.BOT_TOKEN || !env.MINIAPP_LINK) return;

  const link = `${env.MINIAPP_LINK}?startapp=${encodeURIComponent(options.roomId)}`;
  const body = {
    chat_id: options.userId,
    text: `${options.opponentName} сходил — ваш ход.`,
    reply_markup: { inline_keyboard: [[{ text: 'Открыть партию', url: link }]] },
  };

  try {
    const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // Текст ответа безопасен: токен Telegram в теле ошибки не повторяет.
      console.warn('[notify] Telegram отказал', response.status, await response.text());
    }
  } catch (cause) {
    console.warn('[notify] не дозвонились до Bot API', cause);
  }
}
