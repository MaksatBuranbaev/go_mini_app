import {
  BLACK,
  createGame,
  hashBoard,
  play,
  stateFromBoard,
  type Color,
  type GameState,
} from '@go/engine';
import {
  ClientMessageSchema,
  type GameSettings,
  type MoveRecord,
  type RoomPreview,
  type RoomStatus,
  type Seat,
  type SeatColor,
  type ServerMessage,
  type WsErrorCode,
} from '@go/protocol';
import { DurableObject } from 'cloudflare:workers';
import type { RoomUser } from './auth.js';

/**
 * Снапшот позиции — производный кэш, а не источник истины. Он лежит рядом
 * с ходами, чтобы после гибернации не переигрывать партию с первого хода:
 * копия истории ко растёт линейно, и прогон четырёхсот ходов — это уже
 * заметная доля бюджета в 10 мс на вызов.
 */
const SNAPSHOT_EVERY = 50;

interface Snapshot {
  seq: number;
  board: Uint8Array;
  toPlay: Color;
  hash: bigint;
  history: Set<bigint>;
  previousHash: bigint | null;
  capturedByBlack: number;
  capturedByWhite: number;
  passes: number;
  moveNumber: number;
}

interface Meta {
  roomId: string;
  createdAt: number;
  settings: GameSettings;
}

interface Seats {
  black?: Seat;
  white?: Seat;
}

/** Метаданные сокета переживают гибернацию только через serializeAttachment. */
interface SocketInfo {
  userId: number;
  name: string;
  color: SeatColor;
}

function moveKey(seq: number): string {
  return `m:${String(seq).padStart(6, '0')}`;
}

function seatOf(color: Color): SeatColor {
  return color === BLACK ? 'black' : 'white';
}

/**
 * Комната — один Durable Object на партию.
 *
 * Главное ограничение: после гибернации память объекта пуста. Всё состояние
 * живёт в `ctx.storage`, поля класса — только кэш, который в любой момент
 * может оказаться пустым и обязан восстанавливаться из хранилища.
 */
export class Room extends DurableObject<Env> {
  /** Позиция, восстановленная под известный номер хода. Проверяется по `seq`. */
  private cache: { seq: number; game: GameState } | null = null;

  // --- HTTP-вход через Worker ---

  /** Создаёт комнату и сажает автора на выбранный им цвет. */
  async create(
    roomId: string,
    settings: GameSettings,
    user: RoomUser,
  ): Promise<{ settings: GameSettings; yourColor: SeatColor }> {
    const existing = await this.ctx.storage.get<Meta>('meta');
    if (existing) {
      const seats = await this.seats();
      const mine = this.colorOf(seats, user.id);
      if (!mine) throw new Error('комната уже занята');
      return { settings: existing.settings, yourColor: mine };
    }

    // `random` разыгрывается ровно один раз, при создании: иначе превью
    // показывало бы разный расклад на каждый запрос.
    const resolved: GameSettings = {
      ...settings,
      creatorColor:
        settings.creatorColor === 'random'
          ? Math.random() < 0.5
            ? 'black'
            : 'white'
          : settings.creatorColor,
    };
    const yourColor = resolved.creatorColor as SeatColor;

    await this.ctx.storage.put({
      meta: { roomId, createdAt: Date.now(), settings: resolved } satisfies Meta,
      seats: { [yourColor]: { color: yourColor, userId: user.id, name: user.name } } as Seats,
      status: 'waiting' satisfies RoomStatus,
      seq: 0,
      result: null,
    });

    return { settings: resolved, yourColor };
  }

  /** Что показать открывшему ссылку до того, как он займёт место. */
  async preview(user: RoomUser): Promise<RoomPreview | null> {
    const meta = await this.ctx.storage.get<Meta>('meta');
    if (!meta) return null;

    const seats = await this.seats();
    return {
      type: 'preview',
      roomId: meta.roomId,
      settings: meta.settings,
      status: await this.status(),
      seats: seatList(seats),
      yourColor: this.colorOf(seats, user.id) ?? freeSeat(seats),
    };
  }

  /** Апгрейд в WebSocket. Место за доской занимается здесь же, до accept. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('ожидается websocket', { status: 426 });
    }

    const userId = Number(request.headers.get('X-User-Id'));
    const name = decodeURIComponent(request.headers.get('X-User-Name') ?? '');
    if (!Number.isFinite(userId) || userId === 0) {
      return new Response('нет пользователя', { status: 401 });
    }

    const meta = await this.ctx.storage.get<Meta>('meta');
    if (!meta) return new Response('комната не найдена', { status: 404 });

    const color = await this.takeSeat({ id: userId, name });
    if (!color) return new Response('мест за доской нет', { status: 403 });

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ userId, name, color } satisfies SocketInfo);

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // --- WebSocket ---

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') {
      return this.fail(ws, 'bad-message', 'ожидается текстовый кадр');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return this.fail(ws, 'bad-message', 'не разобрать JSON');
    }

    const parsed = ClientMessageSchema.safeParse(payload);
    if (!parsed.success) {
      return this.fail(ws, 'bad-message', 'сообщение не по схеме');
    }

    switch (parsed.data.type) {
      case 'join':
        return this.onJoin(ws, parsed.data.lastSeq);
      case 'move':
        return this.onMove(ws, parsed.data.seq, parsed.data.x, parsed.data.y);
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    // Сокет ещё числится в getWebSockets(), пока обработчик не вернулся.
    await this.broadcastPresence(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.broadcastPresence(ws);
  }

  private async onJoin(ws: WebSocket, lastSeq: number): Promise<void> {
    const seq = await this.currentSeq();

    // Клиент уже что-то видел и не забежал вперёд — хватит дельты.
    if (lastSeq > 0 && lastSeq <= seq) {
      const seats = await this.seats();
      this.send(ws, {
        type: 'sync',
        status: await this.status(),
        seats: seatList(seats),
        moves: await this.movesBetween(lastSeq + 1, seq),
        yourColor: infoOf(ws)?.color ?? null,
        online: this.online(),
        result: await this.result(),
      });
    } else {
      this.send(ws, await this.stateFor(ws));
    }

    await this.broadcastPresence();
  }

  private async onMove(ws: WebSocket, seq: number, x: number, y: number): Promise<void> {
    const info = infoOf(ws);
    if (!info) return this.fail(ws, 'not-seated', 'вы не за доской');

    if ((await this.status()) !== 'playing') {
      return this.fail(ws, 'not-playing', 'партия ещё не идёт');
    }

    // Номер хода проверяется раньше очереди — и это важно именно в таком
    // порядке. Двойной тап и повтор после разрыва приходят с устаревшим seq
    // уже тогда, когда очередь ушла к сопернику; ответить «не ваш ход» значило
    // бы показать игроку ошибку там, где нужно просто досинхронизировать его.
    const current = await this.currentSeq();
    if (seq !== current + 1) {
      this.send(ws, await this.stateFor(ws));
      return;
    }

    const game = await this.loadGame();
    if (seatOf(game.toPlay) !== info.color) {
      return this.fail(ws, 'not-your-turn', 'сейчас не ваш ход');
    }

    const result = play(game, { type: 'play', x, y });
    if (!result.ok) {
      this.fail(ws, 'illegal-move', result.reason);
      this.send(ws, await this.stateFor(ws));
      return;
    }

    const record: MoveRecord = {
      seq: current + 1,
      color: info.color,
      type: 'play',
      x,
      y,
      at: Date.now(),
    };

    await this.ctx.storage.put({ [moveKey(record.seq)]: record, seq: record.seq });
    this.cache = { seq: record.seq, game: result.value };
    await this.maybeSnapshot(record.seq, result.value);

    this.broadcast({ type: 'move', move: record, status: await this.status() });
  }

  // --- состояние ---

  private async loadGame(): Promise<GameState> {
    const seq = await this.currentSeq();
    if (this.cache?.seq === seq) return this.cache.game;

    const meta = await this.ctx.storage.get<Meta>('meta');
    if (!meta) throw new Error('комната без метаданных');
    const { size, komi, handicap } = meta.settings;

    const snapshot = await this.ctx.storage.get<Snapshot>('snapshot');
    let state: GameState;
    let from = 0;

    // Снапшот принимается только если позиция сходится по хешу. Не сошлась —
    // молча выбрасываем: источник истины всё равно список ходов.
    if (snapshot && snapshot.seq <= seq && hashBoard(size, snapshot.board) === snapshot.hash) {
      state = stateFromBoard(snapshot.board, size, snapshot.toPlay, {
        history: snapshot.history,
        previousHash: snapshot.previousHash,
        capturedByBlack: snapshot.capturedByBlack,
        capturedByWhite: snapshot.capturedByWhite,
        passes: snapshot.passes,
        moveNumber: snapshot.moveNumber,
        komi,
        handicap,
      });
      from = snapshot.seq;
    } else {
      state = createGame({ size, komi, handicap });
    }

    for (const move of await this.movesBetween(from + 1, seq)) {
      const next = play(state, toEngineMove(move));
      if (!next.ok) {
        throw new Error(`ход ${move.seq} не воспроизводится: ${next.reason}`);
      }
      state = next.value;
    }

    this.cache = { seq, game: state };
    return state;
  }

  private async maybeSnapshot(seq: number, state: GameState): Promise<void> {
    if (seq % SNAPSHOT_EVERY !== 0) return;
    await this.ctx.storage.put('snapshot', {
      seq,
      board: state.board,
      toPlay: state.toPlay,
      hash: state.hash,
      history: new Set(state.history),
      previousHash: state.previousHash,
      capturedByBlack: state.capturedByBlack,
      capturedByWhite: state.capturedByWhite,
      passes: state.passes,
      moveNumber: state.moveNumber,
    } satisfies Snapshot);
  }

  private async movesBetween(fromSeq: number, toSeq: number): Promise<MoveRecord[]> {
    if (toSeq < fromSeq) return [];
    const rows = await this.ctx.storage.list<MoveRecord>({
      start: moveKey(fromSeq),
      end: moveKey(toSeq + 1),
    });
    return [...rows.values()];
  }

  private async stateFor(ws: WebSocket): Promise<ServerMessage> {
    const meta = await this.ctx.storage.get<Meta>('meta');
    if (!meta) throw new Error('комната без метаданных');
    const seats = await this.seats();

    return {
      type: 'state',
      roomId: meta.roomId,
      settings: meta.settings,
      status: await this.status(),
      seats: seatList(seats),
      moves: await this.movesBetween(1, await this.currentSeq()),
      yourColor: infoOf(ws)?.color ?? null,
      online: this.online(),
      result: await this.result(),
    };
  }

  private async takeSeat(user: RoomUser): Promise<SeatColor | null> {
    const seats = await this.seats();

    // Переподключение возвращает игрока на его сторону, а не на свободную.
    const mine = this.colorOf(seats, user.id);
    if (mine) return mine;

    const free = freeSeat(seats);
    if (!free) return null;

    seats[free] = { color: free, userId: user.id, name: user.name };
    await this.ctx.storage.put('seats', seats);
    if (seats.black && seats.white) {
      await this.ctx.storage.put('status', 'playing' satisfies RoomStatus);
    }
    return free;
  }

  private colorOf(seats: Seats, userId: number): SeatColor | null {
    if (seats.black?.userId === userId) return 'black';
    if (seats.white?.userId === userId) return 'white';
    return null;
  }

  private async seats(): Promise<Seats> {
    return (await this.ctx.storage.get<Seats>('seats')) ?? {};
  }

  private async status(): Promise<RoomStatus> {
    return (await this.ctx.storage.get<RoomStatus>('status')) ?? 'waiting';
  }

  private async result(): Promise<string | null> {
    return (await this.ctx.storage.get<string | null>('result')) ?? null;
  }

  private async currentSeq(): Promise<number> {
    return (await this.ctx.storage.get<number>('seq')) ?? 0;
  }

  // --- рассылка ---

  private online(exclude?: WebSocket): SeatColor[] {
    const colors = new Set<SeatColor>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const info = infoOf(ws);
      if (info) colors.add(info.color);
    }
    return [...colors];
  }

  private async broadcastPresence(exclude?: WebSocket): Promise<void> {
    const seats = await this.seats();
    const message: ServerMessage = {
      type: 'presence',
      online: this.online(exclude),
      seats: seatList(seats),
      status: await this.status(),
    };
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      this.send(ws, message);
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, message);
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Сокет уже закрыт — присутствие поправится обработчиком close.
    }
  }

  private fail(ws: WebSocket, code: WsErrorCode, message: string): void {
    this.send(ws, { type: 'error', code, message });
  }
}

function infoOf(ws: WebSocket): SocketInfo | null {
  return (ws.deserializeAttachment() as SocketInfo | null) ?? null;
}

function seatList(seats: Seats): Seat[] {
  return [seats.black, seats.white].filter((seat): seat is Seat => seat !== undefined);
}

function freeSeat(seats: Seats): SeatColor | null {
  if (!seats.black) return 'black';
  if (!seats.white) return 'white';
  return null;
}

function toEngineMove(move: MoveRecord) {
  if (move.type === 'play') return { type: 'play' as const, x: move.x!, y: move.y! };
  return move.type === 'pass' ? { type: 'pass' as const } : { type: 'resign' as const };
}
