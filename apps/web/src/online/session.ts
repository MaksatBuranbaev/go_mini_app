import { GameSettingsSchema, RoomIdSchema, type GameSettings } from '@go/protocol';
import { z } from 'zod';

const KEY = 'go:room';

const StoredRoomSchema = z.object({
  roomId: RoomIdSchema,
  settings: GameSettingsSchema,
});

export type StoredRoom = z.infer<typeof StoredRoomSchema>;

/**
 * Открытая комната переживает перезагрузку страницы.
 *
 * WebView в Telegram перезагружается сам по себе — при возврате из другого
 * чата, по нехватке памяти, после свёртывания. Без этого игрок каждый раз
 * оказывался бы в лобби, а его место в комнате оставалось бы занятым им же.
 *
 * `sessionStorage`, а не `localStorage`: запись должна умереть вместе с
 * вкладкой, иначе давно доигранная партия открывалась бы снова и снова.
 */
export function rememberRoom(roomId: string, settings: GameSettings): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ roomId, settings }));
  } catch {
    // Приватный режим или переполнение — восстановление просто не сработает.
  }
}

export function forgetRoom(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // см. выше
  }
}

export function restoreRoom(): StoredRoom | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = StoredRoomSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
