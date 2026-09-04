import {
  BLACK,
  createGame,
  groupAt,
  guessDeadStones,
  hashBoard,
  play,
  resumePlay,
  score,
  stateFromBoard,
  toSgf,
  WHITE,
  type Color,
  type GameRecord,
  type GameState,
} from '@go/engine';
import {
  ClientMessageSchema,
  type Clock,
  type GameSettings,
  type MoveRecord,
  type RoomPreview,
  type RoomStatus,
  type Scoring,
  type Seat,
  type SeatColor,
  type ServerMessage,
  type UndoRequest,
  type WsErrorCode,
} from '@go/protocol';
import { DurableObject } from 'cloudflare:workers';
import type { RoomUser } from './auth.js';
import { notifyTurn } from './notify.js';
import {
  afterMove,
  deadline,
  initialClock,
  isExpired,
  resume as resumeClock,
  rewindMove,
  stop as stopClock,
  type ClockState,
} from './clock.js';

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
  /** `null` — наблюдатель: пришёл по ссылке, когда мест уже не было. */
  color: SeatColor | null;
}

function moveKey(seq: number): string {
  return `m:${String(seq).padStart(6, '0')}`;
}

function seatOf(color: Color): SeatColor {
  return color === BLACK ? 'black' : 'white';
}

function other(color: SeatColor): SeatColor {
  return color === 'black' ? 'white' : 'black';
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
      clock: initialClock(resolved.time),
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

  /** Запись партии в SGF: всё, что комната знает о ходах, одной строкой. */
  async sgfText(): Promise<string | null> {
    const meta = await this.ctx.storage.get<Meta>('meta');
    if (!meta) return null;

    const { size, komi, handicap } = meta.settings;
    const seats = await this.seats();
    const moves = await this.movesBetween(1, await this.currentSeq());

    const record: GameRecord = {
      size,
      komi,
      handicap,
      moves: moves.map((move) => ({
        color: move.color === 'black' ? BLACK : WHITE,
        move: toEngineMove(move),
      })),
      date: new Date(meta.createdAt).toISOString().slice(0, 10),
      players: { black: seats.black?.name, white: seats.white?.name },
      rules: meta.settings.rules,
    };

    const result = await this.result();
    if (result) record.result = result;

    // Форовые камни в записи — это не ходы, а расстановка: их ставит движок
    // при создании партии, оттуда их и берём.
    if (handicap >= 2) {
      const start = createGame({ size, komi, handicap });
      const black: number[] = [];
      for (let i = 0; i < start.board.length; i++) if (start.board[i] === BLACK) black.push(i);
      record.setup = { black, white: [] };
    }

    return toSgf(record);
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

    // Мест нет — пускаем смотреть. Это же разруливает гонку, когда ссылку
    // открыли вдвоём: место достаётся первому, второй остаётся наблюдателем.
    const color = await this.takeSeat({ id: userId, name });

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
        return this.onPlay(ws, parsed.data.seq, { x: parsed.data.x, y: parsed.data.y });
      case 'pass':
        return this.onPlay(ws, parsed.data.seq, null);
      case 'resign':
        return this.onResign(ws);
      case 'scoring:toggle':
        return this.onScoringToggle(ws, parsed.data.point);
      case 'scoring:accept':
        return this.onScoringAccept(ws);
      case 'scoring:resume':
        return this.onScoringResume(ws);
      case 'undo:request':
        return this.onUndoRequest(ws);
      case 'undo:answer':
        return this.onUndoAnswer(ws, parsed.data.accept);
      case 'undo:cancel':
        return this.onUndoCancel(ws);
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    // Сокет ещё числится в getWebSockets(), пока обработчик не вернулся.
    await this.broadcastPresence(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.broadcastPresence(ws);
  }

  /**
   * Будильник на просрочку. Он и есть причина, по которой победа по времени
   * вообще работает: партия закрывается, даже если оба клиента отключены
   * и разбудить комнату некому.
   */
  override async alarm(): Promise<void> {
    if ((await this.status()) !== 'playing') return;

    const settings = (await this.meta()).settings;
    const clock = await this.clockState();
    const game = await this.loadGame();
    const toPlay = seatOf(game.toPlay);

    if (isExpired(clock, toPlay, settings.time, Date.now())) {
      await this.finish(other(toPlay) === 'black' ? 'B+T' : 'W+T', null);
      return;
    }

    // Разбудили раньше времени — переставляем будильник на настоящий дедлайн.
    await this.armAlarm(clock, toPlay, settings);
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
        watchers: this.watchers(),
        result: await this.result(),
        clock: await this.clockMessage(),
        scoring: await this.scoring(),
        undo: await this.undo(),
      });
    } else {
      this.send(ws, await this.stateFor(ws));
    }

    await this.broadcastPresence();
  }

  /** Ход и пас — одно и то же по учёту: номер, часы, запись, рассылка. */
  private async onPlay(
    ws: WebSocket,
    seq: number,
    point: { x: number; y: number } | null,
  ): Promise<void> {
    const info = seatedOf(ws);
    if (!info) return this.fail(ws, 'not-seated', 'вы наблюдаете за партией');

    if ((await this.status()) !== 'playing') {
      return this.fail(ws, 'not-playing', 'сейчас не игра');
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

    const result = point
      ? play(game, { type: 'play', x: point.x, y: point.y })
      : play(game, { type: 'pass' });
    if (!result.ok) {
      this.fail(ws, 'illegal-move', result.reason);
      this.send(ws, await this.stateFor(ws));
      return;
    }

    const settings = (await this.meta()).settings;
    const now = Date.now();
    const clock = afterMove(await this.clockState(), info.color, settings.time, now);
    const next = result.value;
    // Два паса подряд — движок сам переводит партию в подсчёт.
    const scoringNow = next.phase === 'scoring';

    const record: MoveRecord = {
      seq: current + 1,
      color: info.color,
      type: point ? 'play' : 'pass',
      ...(point ?? {}),
      at: now,
      timeLeftMs: Math.round(sideMs(clock, info.color)),
    };

    await this.ctx.storage.put({
      [moveKey(record.seq)]: record,
      seq: record.seq,
      clock: scoringNow ? stopClock(clock) : clock,
    });
    this.cache = { seq: record.seq, game: next };
    await this.maybeSnapshot(record.seq, next);

    // Ход рассылается раньше перехода в подсчёт: второй пас — такой же ход
    // с номером, и без него запись партии обрывается, а `lastSeq` у клиентов
    // отстаёт от комнаты.
    this.broadcast({
      type: 'move',
      move: record,
      status: scoringNow ? 'scoring' : 'playing',
      clock: toClockMessage(scoringNow ? stopClock(clock) : clock),
    });

    // Пока соперник думал над ответом, ход сменился — просьба протухла.
    await this.clearUndo();

    if (scoringNow) {
      await this.enterScoring(next);
      return;
    }

    await this.armAlarm(clock, seatOf(next.toPlay), settings);
    await this.notifyIfAway(seatOf(next.toPlay), info.name);
  }

  /**
   * Соперник закрыл мини-апп — зовём его ботом. Уведомление отправляется
   * в фоне: ход уже записан и разослан, и держать ради письма обработчик
   * сообщения незачем.
   */
  private async notifyIfAway(color: SeatColor, opponentName: string): Promise<void> {
    if (this.online().includes(color)) return;

    const seat = (await this.seats())[color];
    if (!seat) return;

    const meta = await this.meta();
    this.ctx.waitUntil(
      notifyTurn(this.env, { userId: seat.userId, roomId: meta.roomId, opponentName }),
    );
  }

  // --- отмена хода ---

  /**
   * Просьба вернуть свой последний ход. Чужой ход отменить нельзя — иначе
   * просьба превращалась бы в способ отобрать у соперника сделанный ход.
   */
  private async onUndoRequest(ws: WebSocket): Promise<void> {
    const info = seatedOf(ws);
    if (!info) return this.fail(ws, 'not-seated', 'вы наблюдаете за партией');
    if ((await this.status()) !== 'playing') {
      return this.fail(ws, 'not-playing', 'сейчас не игра');
    }

    const seq = await this.currentSeq();
    const last = seq > 0 ? (await this.movesBetween(seq, seq))[0] : undefined;
    if (!last || last.color !== info.color) {
      return this.fail(ws, 'nothing-to-undo', 'отменить можно только свой последний ход');
    }

    const request: UndoRequest = { by: info.color, seq };
    await this.ctx.storage.put('undo', request);
    this.broadcast({ type: 'undo', undo: request, declined: false });
  }

  private async onUndoAnswer(ws: WebSocket, accept: boolean): Promise<void> {
    const info = seatedOf(ws);
    if (!info) return this.fail(ws, 'not-seated', 'вы наблюдаете за партией');

    const request = await this.undo();
    // Отвечает соперник просившего: своя же просьба снимается `undo:cancel`.
    if (!request || request.by === info.color) return;

    if (!accept) {
      await this.ctx.storage.delete('undo');
      this.broadcast({ type: 'undo', undo: null, declined: true });
      return;
    }

    await this.applyUndo(request);
  }

  private async onUndoCancel(ws: WebSocket): Promise<void> {
    const info = seatedOf(ws);
    if (!info) return;

    const request = await this.undo();
    if (!request || request.by !== info.color) return;

    await this.clearUndo();
  }

  /**
   * Сам откат. Ход удаляется из записи, номер откатывается назад, кэш и
   * снапшот сбрасываются — и всем уходит полный снапшот: дельтой уменьшение
   * записи не выразить.
   */
  private async applyUndo(request: UndoRequest): Promise<void> {
    const seq = await this.currentSeq();
    // Ход успел смениться между просьбой и согласием — откатывать нечего.
    if (seq !== request.seq || (await this.status()) !== 'playing') {
      await this.clearUndo();
      return;
    }

    const settings = (await this.meta()).settings;
    const clock = rewindMove(await this.clockState(), request.by, settings.time, Date.now());

    await this.ctx.storage.delete(moveKey(seq));
    await this.ctx.storage.delete('undo');
    await this.ctx.storage.put({ seq: seq - 1, clock });

    // Снапшот, снятый на отменённом ходу, сходится сам с собой по хешу и
    // потому пережил бы проверку: после нового хода с тем же номером комната
    // подняла бы из него позицию из другой партии.
    const snapshot = await this.ctx.storage.get<Snapshot>('snapshot');
    if (snapshot && snapshot.seq >= seq) await this.ctx.storage.delete('snapshot');

    this.cache = null;
    const game = await this.loadGame();
    await this.armAlarm(clock, seatOf(game.toPlay), settings);

    for (const socket of this.ctx.getWebSockets()) {
      this.send(socket, await this.stateFor(socket));
    }
  }

  private async clearUndo(): Promise<void> {
    if (!(await this.undo())) return;
    await this.ctx.storage.delete('undo');
    this.broadcast({ type: 'undo', undo: null, declined: false });
  }

  private async onResign(ws: WebSocket): Promise<void> {
    const info = seatedOf(ws);
    if (!info) return this.fail(ws, 'not-seated', 'вы наблюдаете за партией');

    const status = await this.status();
    if (status !== 'playing' && status !== 'scoring') {
      return this.fail(ws, 'not-playing', 'партия уже закончена');
    }

    // Сдаться можно и не в свою очередь, поэтому результат берётся из места
    // сдавшегося, а не из того, чей сейчас ход.
    await this.finish(other(info.color) === 'black' ? 'B+R' : 'W+R', null);
  }

  // --- подсчёт ---

  private async enterScoring(game: GameState): Promise<void> {
    // Эвристика движка — только подсказка: решают всё равно игроки.
    const dead = new Set<number>();
    for (const seed of guessDeadStones(game)) {
      for (const stone of groupPoints(game, seed)) dead.add(stone);
    }

    const scoring: Scoring = { dead: [...dead], acceptedBy: [] };
    await this.ctx.storage.put({ status: 'scoring' satisfies RoomStatus, scoring });
    await this.ctx.storage.deleteAlarm();

    this.broadcast({ type: 'scoring', scoring, status: 'scoring' });
  }

  private async onScoringToggle(ws: WebSocket, point: number): Promise<void> {
    const info = seatedOf(ws);
    if (!info) return this.fail(ws, 'not-seated', 'вы наблюдаете за партией');
    if ((await this.status()) !== 'scoring') {
      return this.fail(ws, 'not-scoring', 'сейчас не подсчёт');
    }

    const game = await this.loadGame();
    if (!game.board[point]) return;

    const scoring = (await this.scoring()) ?? { dead: [], acceptedBy: [] };
    const dead = new Set(scoring.dead);
    const group = groupPoints(game, point);
    const wasDead = group.every((stone) => dead.has(stone));
    for (const stone of group) {
      if (wasDead) dead.delete(stone);
      else dead.add(stone);
    }

    // Любая правка снимает согласие обеих сторон: принимать нужно ту разметку,
    // которую видишь, а не ту, что была минуту назад.
    const next: Scoring = { dead: [...dead], acceptedBy: [] };
    await this.ctx.storage.put('scoring', next);
    this.broadcast({ type: 'scoring', scoring: next, status: 'scoring' });
  }

  private async onScoringAccept(ws: WebSocket): Promise<void> {
    const info = seatedOf(ws);
    if (!info) return this.fail(ws, 'not-seated', 'вы наблюдаете за партией');
    if ((await this.status()) !== 'scoring') {
      return this.fail(ws, 'not-scoring', 'сейчас не подсчёт');
    }

    const scoring = (await this.scoring()) ?? { dead: [], acceptedBy: [] };
    if (scoring.acceptedBy.includes(info.color)) return;

    const next: Scoring = { ...scoring, acceptedBy: [...scoring.acceptedBy, info.color] };
    await this.ctx.storage.put('scoring', next);

    if (next.acceptedBy.length < 2) {
      this.broadcast({ type: 'scoring', scoring: next, status: 'scoring' });
      return;
    }

    const settings = (await this.meta()).settings;
    const final = score(await this.loadGame(), next.dead, settings.rules);
    await this.finish(final.result, { black: final.black, white: final.white });
  }

  private async onScoringResume(ws: WebSocket): Promise<void> {
    const info = seatedOf(ws);
    if (!info) return this.fail(ws, 'not-seated', 'вы наблюдаете за партией');
    if ((await this.status()) !== 'scoring') {
      return this.fail(ws, 'not-scoring', 'сейчас не подсчёт');
    }

    const settings = (await this.meta()).settings;
    const clock = resumeClock(await this.clockState(), Date.now());

    await this.ctx.storage.put({ status: 'playing' satisfies RoomStatus, clock });
    await this.ctx.storage.delete('scoring');
    // Кэш держит позицию с фазой подсчёта — после возврата она уже не та.
    this.cache = null;

    const game = await this.loadGame();
    await this.armAlarm(clock, seatOf(game.toPlay), settings);

    for (const socket of this.ctx.getWebSockets()) {
      this.send(socket, await this.stateFor(socket));
    }
  }

  private async finish(
    result: string,
    score: { black: number; white: number } | null,
  ): Promise<void> {
    await this.ctx.storage.delete('undo');
    await this.ctx.storage.put({
      status: 'finished' satisfies RoomStatus,
      result,
      clock: stopClock(await this.clockState()),
    });
    await this.ctx.storage.deleteAlarm();
    this.cache = null;

    this.broadcast({ type: 'over', result, scoring: await this.scoring(), score });
  }

  // --- состояние ---

  private async loadGame(): Promise<GameState> {
    const seq = await this.currentSeq();
    const status = await this.status();
    if (this.cache?.seq === seq) return this.cache.game;

    const meta = await this.meta();
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
      // Ход после двух пасов — это продолжение после «доиграть»: возврат
      // из подсчёта в записи не отражается, о нём говорит сам факт хода.
      const next = play(resumePlay(state), toEngineMove(move));
      if (!next.ok) {
        throw new Error(`ход ${move.seq} не воспроизводится: ${next.reason}`);
      }
      state = next.value;
    }

    // Фазу задаёт комната, а не список ходов: после «доиграть» два паса
    // остаются в записи, но партия снова идёт.
    if (status === 'playing' && state.phase === 'scoring') state = resumePlay(state);

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
    const meta = await this.meta();
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
      watchers: this.watchers(),
      result: await this.result(),
      clock: await this.clockMessage(),
      scoring: await this.scoring(),
      undo: await this.undo(),
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
      // Второй игрок сел — партия пошла, и вместе с ней часы.
      const settings = (await this.meta()).settings;
      const clock = resumeClock(await this.clockState(), Date.now());
      await this.ctx.storage.put({ status: 'playing' satisfies RoomStatus, clock });
      await this.armAlarm(clock, seatOf((await this.loadGame()).toPlay), settings);
      // Тот, кто ждал, держит снапшот с остановленными часами: без этого
      // он видит нетронутое основное время, пока сервер уже считает.
      this.broadcast({ type: 'clock', clock: toClockMessage(clock) });
    }
    return free;
  }

  private async armAlarm(
    clock: ClockState,
    toPlay: SeatColor,
    settings: GameSettings,
  ): Promise<void> {
    const at = deadline(clock, toPlay, settings.time);
    if (at === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(at);
  }

  private colorOf(seats: Seats, userId: number): SeatColor | null {
    if (seats.black?.userId === userId) return 'black';
    if (seats.white?.userId === userId) return 'white';
    return null;
  }

  private async meta(): Promise<Meta> {
    const meta = await this.ctx.storage.get<Meta>('meta');
    if (!meta) throw new Error('комната без метаданных');
    return meta;
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

  private async scoring(): Promise<Scoring | null> {
    return (await this.ctx.storage.get<Scoring>('scoring')) ?? null;
  }

  private async undo(): Promise<UndoRequest | null> {
    return (await this.ctx.storage.get<UndoRequest>('undo')) ?? null;
  }

  private async clockState(): Promise<ClockState> {
    const stored = await this.ctx.storage.get<ClockState>('clock');
    return stored ?? initialClock((await this.meta()).settings.time);
  }

  private async clockMessage(): Promise<Clock> {
    return toClockMessage(await this.clockState());
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
      if (info?.color) colors.add(info.color);
    }
    return [...colors];
  }

  /** Наблюдатели: сокеты без места за доской. */
  private watchers(exclude?: WebSocket): number {
    let count = 0;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      if (infoOf(ws)?.color === null) count++;
    }
    return count;
  }

  private async broadcastPresence(exclude?: WebSocket): Promise<void> {
    const seats = await this.seats();
    const message: ServerMessage = {
      type: 'presence',
      online: this.online(exclude),
      watchers: this.watchers(exclude),
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

/** Игрок за доской. Наблюдателю здесь отказывают: он смотрит, а не ходит. */
function seatedOf(ws: WebSocket): (SocketInfo & { color: SeatColor }) | null {
  const info = infoOf(ws);
  return info && info.color !== null ? { ...info, color: info.color } : null;
}

function seatList(seats: Seats): Seat[] {
  return [seats.black, seats.white].filter((seat): seat is Seat => seat !== undefined);
}

function freeSeat(seats: Seats): SeatColor | null {
  if (!seats.black) return 'black';
  if (!seats.white) return 'white';
  return null;
}

function sideMs(clock: ClockState, color: SeatColor): number {
  return color === 'black' ? clock.blackMs : clock.whiteMs;
}

function toClockMessage(clock: ClockState): Clock {
  return {
    blackMs: Math.round(clock.blackMs),
    whiteMs: Math.round(clock.whiteMs),
    blackPeriods: clock.blackPeriods,
    whitePeriods: clock.whitePeriods,
    lastMoveAt: clock.lastMoveAt,
    serverNow: Date.now(),
  };
}

/** Вся цепочка, к которой принадлежит камень: тап по одному отмечает группу. */
function groupPoints(game: GameState, point: number): number[] {
  const stones = new Int32Array(game.size * game.size);
  const info = groupAt(game.board, game.size, point, stones);
  return Array.from(stones.subarray(0, info.count));
}

function toEngineMove(move: MoveRecord) {
  if (move.type === 'play') return { type: 'play' as const, x: move.x!, y: move.y! };
  return move.type === 'pass' ? { type: 'pass' as const } : { type: 'resign' as const };
}
