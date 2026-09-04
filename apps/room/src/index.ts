import {
  CreateRoomRequestSchema,
  RoomIdSchema,
  type ApiError,
  type CreateRoomResponse,
  type Health,
} from '@go/protocol';
import { authenticate, type RoomUser } from './auth.js';

export { Room } from './room.js';

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * Двенадцать символов из 64 — это 72 бита. Комнату не «подберут» перебором,
 * а ссылка остаётся достаточно короткой для deep link.
 */
function newRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => ID_ALPHABET[b & 63]).join('');
}

function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
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
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
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
  return json({ type: 'error', code, message } satisfies ApiError, request, env, status);
}

function roomStub(env: Env, roomId: string): DurableObjectStub<import('./room.js').Room> {
  return env.ROOM.get(env.ROOM.idFromName(roomId));
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
      return json({ type: 'health', ok: true } satisfies Health, request, env);
    }

    if (!env.BOT_TOKEN) {
      return fail(
        'server-misconfigured',
        'BOT_TOKEN не задан: комната не может проверить подпись',
        request,
        env,
        503,
      );
    }

    // POST /rooms — создать комнату под настройки лобби.
    if (request.method === 'POST' && url.pathname === '/rooms') {
      const user = await authenticate(request, env);
      if (!user) return unauthorized(request, env);

      const body = CreateRoomRequestSchema.safeParse(await readJson(request));
      if (!body.success) {
        return fail('bad-request', 'настройки партии не по схеме', request, env, 400);
      }

      const roomId = newRoomId();
      const created = await roomStub(env, roomId).create(roomId, body.data.settings, user);
      return json(
        {
          type: 'room',
          roomId,
          settings: created.settings,
          yourColor: created.yourColor,
        } satisfies CreateRoomResponse,
        request,
        env,
      );
    }

    const roomMatch = url.pathname.match(/^\/rooms\/([^/]+)(\/ws|\/sgf)?$/);
    if (roomMatch) {
      const parsed = RoomIdSchema.safeParse(decodeURIComponent(roomMatch[1]!));
      if (!parsed.success) {
        return fail('bad-room-id', 'некорректный id комнаты', request, env, 400);
      }
      const roomId = parsed.data;

      const user = await authenticate(request, env);
      if (!user) return unauthorized(request, env);

      // GET /rooms/:id/ws — живое соединение с комнатой.
      if (roomMatch[2] === '/ws') {
        return roomStub(env, roomId).fetch(internalRequest(request, user));
      }

      // GET /rooms/:id/sgf — запись партии текстом.
      if (roomMatch[2] === '/sgf' && request.method === 'GET') {
        const sgf = await roomStub(env, roomId).sgfText();
        if (!sgf) return fail('not-found', 'комната не найдена', request, env, 404);
        return new Response(sgf, {
          headers: {
            'Content-Type': 'application/x-go-sgf; charset=utf-8',
            'Content-Disposition': `attachment; filename="${roomId}.sgf"`,
            'Cache-Control': 'no-store',
            ...corsHeaders(request, env),
          },
        });
      }

      // GET /rooms/:id — превью для экрана приглашения.
      if (request.method === 'GET') {
        const preview = await roomStub(env, roomId).preview(user);
        if (!preview) return fail('not-found', 'комната не найдена', request, env, 404);
        return json(preview, request, env);
      }
    }

    return fail('not-found', 'нет такого маршрута', request, env, 404);
  },
} satisfies ExportedHandler<Env>;

function unauthorized(request: Request, env: Env): Response {
  return fail('unauthorized', 'initData отсутствует или подпись неверна', request, env, 401);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Комната доступна только через этот Worker, поэтому проверенного пользователя
 * можно передать заголовками: подделать их снаружи невозможно.
 */
function internalRequest(request: Request, user: RoomUser): Request {
  const headers = new Headers(request.headers);
  headers.set('X-User-Id', String(user.id));
  headers.set('X-User-Name', encodeURIComponent(user.name));
  return new Request(request.url, {
    method: request.method,
    headers,
  });
}
