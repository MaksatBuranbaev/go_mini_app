import { parse, validate } from '@telegram-apps/init-data-node/web';

export interface RoomUser {
  id: number;
  name: string;
}

/**
 * Проверенный отправитель запроса.
 *
 * Подпись initData проверяется здесь, в Worker'е, и только здесь: `BOT_TOKEN` —
 * секрет Worker'а, он никогда не попадает в бандл мини-аппа. Durable Object
 * получает уже разобранного пользователя и заново ничего не проверяет.
 */
export async function authenticate(request: Request, env: Env): Promise<RoomUser | null> {
  if (!env.BOT_TOKEN) return null;

  const raw = rawInitData(request);
  if (!raw) return null;

  try {
    await validate(raw, env.BOT_TOKEN, { expiresIn: INIT_DATA_TTL_SECONDS });
    // `parse` отдаёт поля в snake_case, хотя тип обещает camelCase, и из-за
    // индексной сигнатуры в схеме `user.firstName` спокойно проходит проверку
    // типов, оставаясь undefined. Читаем ровно те ключи, что приходят.
    const user = parse(raw).user as Partial<TelegramUser> | undefined;
    if (!user || typeof user.id !== 'number') return null;

    return {
      id: user.id,
      name: displayName(user.first_name, user.last_name, user.username),
    };
  } catch {
    return null;
  }
}

interface TelegramUser {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
}

/**
 * Сутки — значение по умолчанию у самой библиотеки. Больше брать нельзя:
 * initData не отзывается, и просроченная подпись остаётся валидной навсегда.
 * Меньше — мини-апп начнёт отваливаться у того, кто держит его открытым.
 */
const INIT_DATA_TTL_SECONDS = 86_400;

/**
 * `Authorization: tma <raw>` для обычных запросов и `?initData=` для WebSocket:
 * браузерный WebSocket не умеет ставить заголовки, другого места просто нет.
 */
function rawInitData(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (header?.startsWith('tma ')) return header.slice(4);

  const fromQuery = new URL(request.url).searchParams.get('initData');
  return fromQuery && fromQuery.length > 0 ? fromQuery : null;
}

function displayName(first?: string, last?: string, username?: string): string {
  const full = [first, last].filter(Boolean).join(' ').trim();
  return full || username || 'Игрок';
}
