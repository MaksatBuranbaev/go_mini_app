import { HTTP, WS, TOKEN } from './config.mjs';
import { sleep } from './harness.mjs';

async function hmac(key, message) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
}

const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Подписанная initData локальным токеном из `.dev.vars`. Комната проверяет
 * подпись всерьёз и в dev тоже: обхода для тестов в ней намеренно нет.
 */
export async function initDataFor(id, name, token = TOKEN) {
  const params = {
    user: JSON.stringify({ id, first_name: name, username: `u${id}` }),
    auth_date: Math.floor(Date.now() / 1000).toString(),
    signature: 'mock-signature',
  };
  const pairs = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1));
  const secret = await hmac(new TextEncoder().encode('WebAppData'), token);
  const sig = await hmac(secret, pairs.map(([k, v]) => `${k}=${v}`).join('\n'));
  return new URLSearchParams([...pairs, ['hash', hex(sig)]]).toString();
}

export const DEFAULT_SETTINGS = {
  size: 9,
  komi: 5.5,
  handicap: 0,
  creatorColor: 'black',
  time: { type: 'none' },
  rules: 'chinese',
};

/** Создаёт комнату по HTTP и возвращает её id. */
export async function createRoom(initData, settings = {}) {
  const created = await fetch(`${HTTP}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `tma ${initData}` },
    body: JSON.stringify({ settings: { ...DEFAULT_SETTINGS, ...settings } }),
  }).then((r) => r.json());
  if (created.type !== 'room') throw new Error('комната не создалась: ' + JSON.stringify(created));
  return created.roomId;
}

/** Клиент комнаты: копит входящие сообщения, чтобы их можно было проверить. */
export class Client {
  constructor(label, socket) {
    this.label = label;
    this.socket = socket;
    this.inbox = [];
    /** Последнее известное число зрителей: presence приходит без спроса. */
    this.watchers = null;
    socket.onmessage = (e) => {
      const message = JSON.parse(e.data);
      if (typeof message.watchers === 'number') this.watchers = message.watchers;
      this.inbox.push(message);
    };
  }

  static async connect(label, roomId, initData) {
    const socket = new WebSocket(
      `${WS}/rooms/${roomId}/ws?initData=${encodeURIComponent(initData)}`,
    );
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error(`${label}: соединение отклонено`));
    });
    return new Client(label, socket);
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  /** Ждёт сообщение нужного типа и забирает его из очереди. */
  async take(type, timeout = 4000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const index = this.inbox.findIndex((m) => m.type === type);
      if (index >= 0) return this.inbox.splice(index, 1)[0];
      await sleep(40);
    }
    return null;
  }

  /** Выбрасывает накопленное: иначе take() достанет эхо прошлых ходов. */
  drain() {
    this.inbox.length = 0;
  }

  close() {
    this.socket.close();
  }
}
