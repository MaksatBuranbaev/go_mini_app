import { z } from 'zod';

/**
 * Идентификатор комнаты. Ровно он и едет в deep link как start_param,
 * поэтому алфавит ограничен тем, что Telegram пропускает без экранирования:
 * A-Z a-z 0-9 _ -
 */
export const RoomIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'room id: допустимы только A-Z a-z 0-9 _ -');

export type RoomId = z.infer<typeof RoomIdSchema>;

export const ColorSchema = z.enum(['black', 'white']);
export type SeatColor = z.infer<typeof ColorSchema>;

export const BoardSizeSchema = z.union([z.literal(9), z.literal(13), z.literal(19)]);

export const GameSettingsSchema = z.object({
  size: BoardSizeSchema,
  komi: z.number().min(-100).max(100),
  handicap: z.number().int().min(0).max(9),
  /** Цвет создателя. `random` комната разыгрывает один раз, при создании. */
  creatorColor: z.enum(['black', 'white', 'random']),
});

export type GameSettings = z.infer<typeof GameSettingsSchema>;

export const RoomStatusSchema = z.enum(['waiting', 'playing', 'scoring', 'finished']);
export type RoomStatus = z.infer<typeof RoomStatusSchema>;

export const SeatSchema = z.object({
  color: ColorSchema,
  userId: z.number().int(),
  name: z.string(),
});

export type Seat = z.infer<typeof SeatSchema>;

/**
 * Запись хода. Позиция на доске нигде не хранится — она восстанавливается
 * прогоном этого списка через движок, поэтому здесь лежит всё, что нужно
 * для воспроизведения, и ничего сверх того.
 */
export const MoveRecordSchema = z.object({
  seq: z.number().int().positive(),
  color: ColorSchema,
  type: z.enum(['play', 'pass', 'resign']),
  x: z.number().int().nonnegative().optional(),
  y: z.number().int().nonnegative().optional(),
  at: z.number().int().nonnegative(),
});

export type MoveRecord = z.infer<typeof MoveRecordSchema>;

// --- HTTP ---

export const CreateRoomRequestSchema = z.object({
  settings: GameSettingsSchema,
});

export const CreateRoomResponseSchema = z.object({
  type: z.literal('room'),
  roomId: RoomIdSchema,
  settings: GameSettingsSchema,
  yourColor: ColorSchema,
});

export type CreateRoomResponse = z.infer<typeof CreateRoomResponseSchema>;

/** Что видит человек, открывший ссылку-приглашение, до того как сядет за доску. */
export const RoomPreviewSchema = z.object({
  type: z.literal('preview'),
  roomId: RoomIdSchema,
  settings: GameSettingsSchema,
  status: RoomStatusSchema,
  seats: z.array(SeatSchema),
  /** Цвет, за который сядет именно этот пользователь, или null — мест нет. */
  yourColor: ColorSchema.nullable(),
});

export type RoomPreview = z.infer<typeof RoomPreviewSchema>;

export const HealthSchema = z.object({
  type: z.literal('health'),
  ok: z.literal(true),
});

export type Health = z.infer<typeof HealthSchema>;

export const ApiErrorCodeSchema = z.enum([
  'bad-room-id',
  'bad-request',
  'not-found',
  'forbidden-origin',
  'unauthorized',
  'room-full',
  'server-misconfigured',
]);

export const ApiErrorSchema = z.object({
  type: z.literal('error'),
  code: ApiErrorCodeSchema,
  message: z.string(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

// --- WebSocket: клиент → комната ---

/**
 * `lastSeq` — номер последнего хода, который клиент уже видел. Ноль означает
 * «начинаю с нуля, пришлите всё».
 */
export const ClientJoinSchema = z.object({
  type: z.literal('join'),
  lastSeq: z.number().int().min(0),
});

/**
 * `seq` — номер, который клиент ожидает у своего хода. Не совпал с тем, что
 * у комнаты, — значит клиент отстал или продублировал тап, и вместо хода
 * он получит полное состояние.
 */
export const ClientMoveSchema = z.object({
  type: z.literal('move'),
  seq: z.number().int().positive(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});

// Пас, сдача и разметка мёртвых камней появятся вместе с завершением партии.
export const ClientMessageSchema = z.discriminatedUnion('type', [
  ClientJoinSchema,
  ClientMoveSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// --- WebSocket: комната → клиент ---

/** Полный снапшот. Отправляется на join с нуля и всякий раз при рассинхроне. */
export const ServerStateSchema = z.object({
  type: z.literal('state'),
  roomId: RoomIdSchema,
  settings: GameSettingsSchema,
  status: RoomStatusSchema,
  seats: z.array(SeatSchema),
  moves: z.array(MoveRecordSchema),
  yourColor: ColorSchema.nullable(),
  online: z.array(ColorSchema),
  result: z.string().nullable(),
});

export type ServerState = z.infer<typeof ServerStateSchema>;

/** Дельта на реконнект: только то, что случилось после `lastSeq` клиента. */
export const ServerSyncSchema = z.object({
  type: z.literal('sync'),
  status: RoomStatusSchema,
  seats: z.array(SeatSchema),
  moves: z.array(MoveRecordSchema),
  yourColor: ColorSchema.nullable(),
  online: z.array(ColorSchema),
  result: z.string().nullable(),
});

export const ServerMoveSchema = z.object({
  type: z.literal('move'),
  move: MoveRecordSchema,
  status: RoomStatusSchema,
});

export const ServerPresenceSchema = z.object({
  type: z.literal('presence'),
  online: z.array(ColorSchema),
  seats: z.array(SeatSchema),
  status: RoomStatusSchema,
});

export const WsErrorCodeSchema = z.enum([
  'bad-message',
  'not-seated',
  'not-your-turn',
  'not-playing',
  'illegal-move',
]);

export type WsErrorCode = z.infer<typeof WsErrorCodeSchema>;

export const ServerErrorSchema = z.object({
  type: z.literal('error'),
  code: WsErrorCodeSchema,
  message: z.string(),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  ServerStateSchema,
  ServerSyncSchema,
  ServerMoveSchema,
  ServerPresenceSchema,
  ServerErrorSchema,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/** Код закрытия для «сесть за доску нельзя»: мест нет либо гость посторонний. */
export const CLOSE_ROOM_FULL = 4001;
