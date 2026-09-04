import { cloudStorage } from '@telegram-apps/sdk-react';
import { isMockedEnv } from '../telegram/mockEnv.js';

/**
 * Архив партий.
 *
 * Хранилище — `CloudStorage` Telegram: он привязан к пользователю и сам ездит
 * между его устройствами, так что своей базы не нужно. Ограничения у него
 * жёсткие: ключ только из `[A-Za-z0-9_-]`, значение до 4096 символов, всего
 * до 1024 ключей. Поэтому список партий лежит одним ключом, а записи — по
 * ключу на партию, и список подрезается до последних тридцати.
 *
 * Вне Telegram (dev-моки, обычный браузер) всё то же самое ложится в
 * localStorage: экран архива обязан работать и там, иначе его не отладить.
 */
export interface ArchivedGame {
  /** id комнаты, либо локальный ключ для партии на одном устройстве. */
  id: string;
  /** Когда партия закончилась. */
  at: number;
  size: number;
  komi: number;
  handicap: number;
  result: string | null;
  moves: number;
  black: string;
  white: string;
  /** Партия сыграна на одном устройстве — у неё нет комнаты на сервере. */
  local: boolean;
}

const INDEX_KEY = 'go_index';
const LIMIT = 30;
/** Запас к лимиту Telegram: длинная партия 19×19 в него всё равно уложится. */
const VALUE_LIMIT = 4000;

const sgfKey = (id: string) => `go_sgf_${id}`;

/**
 * Мок в dev не отвечает на кастомные методы, и запрос к облаку в нём повиснет
 * навсегда, поэтому там сразу localStorage. Ожидание тоже ограничено: клиент,
 * который промолчит, не должен вешать экран архива.
 */
function cloudAvailable(): boolean {
  return !isMockedEnv() && cloudStorage.getItem.isAvailable();
}

function withTimeout<T>(promise: PromiseLike<T>, ms = 5000): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('облако молчит')), ms)),
  ]);
}

async function readKey(key: string): Promise<string> {
  if (!cloudAvailable()) return localStorage.getItem(key) ?? '';
  try {
    return await withTimeout(cloudStorage.getItem(key));
  } catch (cause) {
    console.warn('[архив] облако недоступно, читаем локально', cause);
    return localStorage.getItem(key) ?? '';
  }
}

async function writeKey(key: string, value: string): Promise<void> {
  if (!cloudAvailable()) {
    localStorage.setItem(key, value);
    return;
  }
  try {
    await withTimeout(cloudStorage.setItem(key, value));
  } catch (cause) {
    console.warn('[архив] облако не приняло запись, кладём локально', cause);
    localStorage.setItem(key, value);
  }
}

async function dropKey(key: string): Promise<void> {
  localStorage.removeItem(key);
  if (!cloudAvailable()) return;
  try {
    await withTimeout(cloudStorage.deleteItem(key));
  } catch (cause) {
    console.warn('[архив] не удалось стереть в облаке', cause);
  }
}

export async function listGames(): Promise<ArchivedGame[]> {
  const raw = await readKey(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ArchivedGame[]) : [];
  } catch {
    // Битый список лечится сам: партии всё равно не восстановить, а зависать
    // на разборе мусора экрану ни к чему.
    return [];
  }
}

/**
 * Кладёт партию в архив. Запись и список пишутся разными ключами, поэтому
 * запись сохраняем первой: партия без записи покажется в списке без просмотра,
 * а запись без списка не покажется вовсе.
 */
export async function saveGame(game: ArchivedGame, sgf: string): Promise<void> {
  if (sgf.length <= VALUE_LIMIT) {
    await writeKey(sgfKey(game.id), sgf);
  } else {
    console.warn('[архив] запись длиннее лимита облака, сохраняем только партию');
  }

  const games = await listGames();
  const next = [game, ...games.filter((entry) => entry.id !== game.id)].slice(0, LIMIT);
  await writeKey(INDEX_KEY, JSON.stringify(next));

  // Всё, что вылезло за лимит, уносим вместе с записями: иначе ключи копятся
  // молча и упираются в потолок в 1024 штуки.
  for (const stale of games.slice(LIMIT - 1)) {
    if (!next.some((entry) => entry.id === stale.id)) await dropKey(sgfKey(stale.id));
  }
}

export async function loadSgf(id: string): Promise<string | null> {
  const value = await readKey(sgfKey(id));
  return value || null;
}

export async function removeGame(id: string): Promise<void> {
  const games = await listGames();
  await writeKey(INDEX_KEY, JSON.stringify(games.filter((entry) => entry.id !== id)));
  await dropKey(sgfKey(id));
}
