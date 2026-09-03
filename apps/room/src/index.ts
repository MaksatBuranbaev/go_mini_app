import { DurableObject } from 'cloudflare:workers';
import {
  RoomIdSchema,
  type ApiError,
  type Health,
  type RoomPong,
} from '@go/protocol';

/**
 * Комната — один Durable Object на партию.
 *
 * Фаза 0: комната пока умеет только подтверждать своё существование. Важно
 * здесь одно — состояние живёт в `ctx.storage`, а не в полях класса. После
 * гибернации память объекта пуста, и любое поле, пережившее её «по ощущениям»,
 * на самом деле просто не успело выгрузиться.
 */
export class Room extends DurableObject<Env> {
  async ping(roomId: string): Promise<RoomPong> {
    const createdAt = (await this.ctx.storage.get<number>('createdAt')) ?? Date.now();
    const pings = ((await this.ctx.storage.get<number>('pings')) ?? 0) + 1;
    await this.ctx.storage.put({ createdAt, pings });
    return { type: 'pong', roomId, createdAt, pings };
  }
}

function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Статика лежит на Pages, комната — на workers.dev: origin'ы разные, без CORS
 * браузер до комнаты не достучится. Разрешаем только явно перечисленные адреса.
 */
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, request: Request, env: Env, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request, env),
    },
  });
}

function fail(
  code: ApiError['code'],
  message: string,
  request: Request,
  env: Env,
  status: number,
): Response {
  const body: ApiError = { type: 'error', code, message };
  return json(body, request, env, status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      const headers = corsHeaders(request, env);
      if (!('Access-Control-Allow-Origin' in headers)) {
        return fail('forbidden-origin', 'origin не разрешён', request, env, 403);
      }
      return new Response(null, { status: 204, headers });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      const body: Health = { type: 'health', ok: true };
      return json(body, request, env);
    }

    // GET /rooms/:id/ping — разбудить комнату и убедиться, что её storage пишется.
    const pingMatch = url.pathname.match(/^\/rooms\/([^/]+)\/ping$/);
    if (request.method === 'GET' && pingMatch) {
      const parsed = RoomIdSchema.safeParse(decodeURIComponent(pingMatch[1]!));
      if (!parsed.success) {
        return fail('bad-room-id', 'некорректный id комнаты', request, env, 400);
      }
      const roomId = parsed.data;
      const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
      return json(await stub.ping(roomId), request, env);
    }

    return fail('not-found', 'нет такого маршрута', request, env, 404);
  },
} satisfies ExportedHandler<Env>;
