/** Куда стучатся прогоны. Всё локальное: dev-комната, dev-статика, headless-браузер. */
export const HTTP = process.env.ROOM_HTTP ?? 'http://127.0.0.1:8787';
export const WS = process.env.ROOM_WS ?? 'ws://127.0.0.1:8787';
export const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
export const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9222';

/** Тот же токен, что в `apps/room/.dev.vars`: подпись initData должна сойтись. */
export const TOKEN = process.env.DEV_BOT_TOKEN ?? '1234567890:TEST_TOKEN_FOR_LOCAL_DEV_ONLY';
