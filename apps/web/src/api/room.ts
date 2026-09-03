import { RoomPongSchema, type RoomPong } from '@go/protocol';

/**
 * Адрес комнаты. Публичный, секретов в нём нет, поэтому лежит в коде:
 * так прод-сборка воспроизводима без внешнего окружения.
 * VITE_ROOM_URL перекрывает его — например, для туннеля в dev.
 */
const DEFAULT_ROOM_URL = import.meta.env.DEV
  ? 'http://localhost:8787'
  : 'https://go-room.zenfonemaxprom124.workers.dev';

const ROOM_URL = (import.meta.env.VITE_ROOM_URL ?? DEFAULT_ROOM_URL).replace(/\/+$/, '');

export function roomBaseUrl(): string {
  return ROOM_URL;
}

/**
 * Будит комнату и убеждается, что её storage пишется.
 * Ответ валидируется той же схемой, которой комната его собирала.
 */
export async function pingRoom(roomId: string, signal?: AbortSignal): Promise<RoomPong> {
  const res = await fetch(`${ROOM_URL}/rooms/${encodeURIComponent(roomId)}/ping`, { signal });
  if (!res.ok) {
    throw new Error(`комната ответила ${res.status}`);
  }
  return RoomPongSchema.parse(await res.json());
}

/** id комнаты для случая, когда приложение открыли без deep link. */
export function randomRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
