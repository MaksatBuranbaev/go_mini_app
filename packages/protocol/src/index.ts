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

/**
 * Контроль времени.
 *
 * Фишер: за каждый сделанный ход к остатку прибавляется `incrementMs`.
 * Бёёми: когда основное время кончилось, у игрока остаётся `periods`
 * периодов по `periodMs`; ход, уложившийся в период, его не тратит.
 */
export const TimeControlSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({
    type: z.literal('fischer'),
    mainMs: z.number().int().positive(),
    incrementMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('byoyomi'),
    mainMs: z.number().int().nonnegative(),
    periodMs: z.number().int().positive(),
    periods: z.number().int().positive().max(10),
  }),
]);

export type TimeControl = z.infer<typeof TimeControlSchema>;

export const GameSettingsSchema = z.object({
  size: BoardSizeSchema,
  komi: z.number().min(-100).max(100),
  handicap: z.number().int().min(0).max(9),
  /** Цвет создателя. `random` комната разыгрывает один раз, при создании. */
  creatorColor: z.enum(['black', 'white', 'random']),
  time: TimeControlSchema,
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
  /** Сколько времени осталось у ходившего сразу после хода. */
  timeLeftMs: z.number().int().nonnegative().optional(),
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
 * Показания часов на момент `lastMoveAt`. Клиент интерполирует их сам,
 * а `serverNow` нужен, чтобы вычесть расхождение его часов с комнатой.
 */
export const ClockSchema = z.object({
  blackMs: z.number().int().nonnegative(),
  whiteMs: z.number().int().nonnegative(),
  blackPeriods: z.number().int().nonnegative(),
  whitePeriods: z.number().int().nonnegative(),
  /** Момент, от которого течёт время текущего игрока. Null — часы стоят. */
  lastMoveAt: z.number().int().nonnegative().nullable(),
  serverNow: z.number().int().nonnegative(),
});

export type Clock = z.infer<typeof ClockSchema>;

/** Разметка мёртвых камней и то, кто из игроков её уже принял. */
export const ScoringSchema = z.object({
  dead: z.array(z.number().int().nonnegative()),
  acceptedBy: z.array(ColorSchema),
});

export type Scoring = z.infer<typeof ScoringSchema>;

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

/** Пас идёт с тем же `seq`, что и обычный ход: он такой же ход по счёту. */
export const ClientPassSchema = z.object({
  type: z.literal('pass'),
  seq: z.number().int().positive(),
});

export const ClientResignSchema = z.object({ type: z.literal('resign') });

/** Тап по группе в фазе подсчёта. Любая правка снимает согласие обеих сторон. */
export const ClientScoringToggleSchema = z.object({
  type: z.literal('scoring:toggle'),
  point: z.number().int().nonnegative(),
});

export const ClientScoringAcceptSchema = z.object({ type: z.literal('scoring:accept') });
export const ClientScoringResumeSchema = z.object({ type: z.literal('scoring:resume') });

export const ClientMessageSchema = z.discriminatedUnion('type', [
  ClientJoinSchema,
  ClientMoveSchema,
  ClientPassSchema,
  ClientResignSchema,
  ClientScoringToggleSchema,
  ClientScoringAcceptSchema,
  ClientScoringResumeSchema,
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
  clock: ClockSchema,
  scoring: ScoringSchema.nullable(),
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
  clock: ClockSchema,
  scoring: ScoringSchema.nullable(),
});

export const ServerMoveSchema = z.object({
  type: z.literal('move'),
  move: MoveRecordSchema,
  status: RoomStatusSchema,
  clock: ClockSchema,
});

/**
 * Сверка часов. Комната шлёт её вместе с ходами и на подключение; между
 * ними клиент считает остаток сам, вычитая время от `lastMoveAt`.
 */
export const ServerClockSchema = z.object({
  type: z.literal('clock'),
  clock: ClockSchema,
});

/** Разметка мёртвых камней изменилась у кого-то из игроков. */
export const ServerScoringSchema = z.object({
  type: z.literal('scoring'),
  scoring: ScoringSchema,
  status: RoomStatusSchema,
});

/** Партия закрыта: подсчётом, сдачей или просрочкой. */
export const ServerOverSchema = z.object({
  type: z.literal('over'),
  result: z.string(),
  scoring: ScoringSchema.nullable(),
  /** Итог подсчёта, если партия закрылась счётом, а не сдачей или временем. */
  score: z
    .object({
      black: z.number(),
      white: z.number(),
    })
    .nullable(),
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
  'not-scoring',
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
  ServerClockSchema,
  ServerScoringSchema,
  ServerOverSchema,
  ServerPresenceSchema,
  ServerErrorSchema,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/** Код закрытия для «сесть за доску нельзя»: мест нет либо гость посторонний. */
export const CLOSE_ROOM_FULL = 4001;
