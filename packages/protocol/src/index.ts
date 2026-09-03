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

/** Ответ комнаты на пинг. Фаза 0: доказывает, что DO жив и его storage пишется. */
export const RoomPongSchema = z.object({
  type: z.literal('pong'),
  roomId: RoomIdSchema,
  /** Когда объект комнаты был создан впервые, мс epoch. */
  createdAt: z.number().int().nonnegative(),
  /** Сколько раз комнату пинговали за всю её жизнь. Растёт между гибернациями. */
  pings: z.number().int().nonnegative(),
});

export type RoomPong = z.infer<typeof RoomPongSchema>;

export const HealthSchema = z.object({
  type: z.literal('health'),
  ok: z.literal(true),
});

export type Health = z.infer<typeof HealthSchema>;

export const ApiErrorSchema = z.object({
  type: z.literal('error'),
  code: z.enum(['bad-room-id', 'not-found', 'forbidden-origin']),
  message: z.string(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
