import {
  ApiErrorSchema,
  CreateRoomResponseSchema,
  RoomPreviewSchema,
  type CreateRoomResponse,
  type GameSettings,
  type RoomPreview,
} from '@go/protocol';
import { retrieveRawInitData } from '@telegram-apps/sdk-react';

/**
 * Адрес комнаты. Воркер у каждого свой, поэтому в коде его нет: прод-сборка
 * берёт адрес из `VITE_ROOM_URL`, dev — из локального `wrangler dev`. Той же
 * переменной подставляется туннель, когда мини-апп открывают из Telegram.
 */
const ROOM_URL = (
  import.meta.env.VITE_ROOM_URL ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')
).replace(/\/+$/, '');

if (!ROOM_URL) {
  // Уехать на относительный путь хуже: приложение выглядело бы живым и падало
  // на первом же запросе к несуществующему адресу.
  throw new Error('VITE_ROOM_URL не задан: сборке неоткуда узнать адрес комнаты');
}

/** Ссылка на сам мини-апп: к ней дописывается id комнаты как startapp. */
const MINI_APP_LINK = import.meta.env.VITE_MINIAPP_LINK ?? 'https://t.me/ten_gen_bot/go_game';

export function roomBaseUrl(): string {
  return ROOM_URL;
}

export function inviteLink(roomId: string): string {
  return `${MINI_APP_LINK}?startapp=${encodeURIComponent(roomId)}`;
}

/**
 * initData едет в заголовке: комната проверяет подпись и достаёт из неё
 * пользователя. Мини-апп своего id не сообщает — ему бы не поверили.
 */
function authHeaders(): Record<string, string> {
  const raw = retrieveRawInitData();
  return raw ? { Authorization: `tma ${raw}` } : {};
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${ROOM_URL}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) },
    });
  } catch {
    // `Failed to fetch` игроку ничего не объясняет: до комнаты не дошёл сам
    // запрос, и единственная понятная причина этому — связь.
    throw new Error('Комната не отвечает — проверьте связь');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw new Error(parsed.success ? parsed.data.message : `комната ответила ${response.status}`);
  }
  return body;
}

export async function createRoom(settings: GameSettings): Promise<CreateRoomResponse> {
  return CreateRoomResponseSchema.parse(
    await request('/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    }),
  );
}

export async function fetchRoomPreview(roomId: string): Promise<RoomPreview> {
  return RoomPreviewSchema.parse(await request(`/rooms/${encodeURIComponent(roomId)}`));
}

/** Запись партии из комнаты. Нужна, когда её нет в облаке у игрока. */
export async function fetchSgf(roomId: string): Promise<string | null> {
  const response = await fetch(`${ROOM_URL}/rooms/${encodeURIComponent(roomId)}/sgf`, {
    headers: authHeaders(),
  });
  if (!response.ok) return null;
  return response.text();
}

/**
 * Адрес живого соединения. Браузерный WebSocket не умеет заголовки, поэтому
 * initData уезжает параметром запроса — другого места для него нет.
 *
 * Считается заново на каждое переподключение: initData не вечна, а сокет
 * в мобильном WebView рвётся часто.
 */
export function roomSocketUrl(roomId: string): string {
  const base = ROOM_URL.replace(/^http/, 'ws');
  const initData = retrieveRawInitData() ?? '';
  return `${base}/rooms/${encodeURIComponent(roomId)}/ws?initData=${encodeURIComponent(initData)}`;
}
