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
 * Адрес комнаты. Публичный, секретов в нём нет, поэтому лежит в коде:
 * так прод-сборка воспроизводима без внешнего окружения.
 * VITE_ROOM_URL перекрывает его — например, для туннеля в dev.
 */
const DEFAULT_ROOM_URL = import.meta.env.DEV
  ? 'http://localhost:8787'
  : 'https://go-room.zenfonemaxprom124.workers.dev';

const ROOM_URL = (import.meta.env.VITE_ROOM_URL ?? DEFAULT_ROOM_URL).replace(/\/+$/, '');

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
  const response = await fetch(`${ROOM_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) },
  });

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
