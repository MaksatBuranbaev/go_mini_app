import {
  BLACK,
  WHITE,
  createGame,
  play,
  resumePlay,
  type Color,
  type GameState,
  type RecordedMove,
} from '@go/engine';
import {
  ServerMessageSchema,
  type ClientMessage,
  type Clock,
  type GameSettings,
  type MoveRecord,
  type RoomStatus,
  type Scoring,
  type Seat,
  type SeatColor,
} from '@go/protocol';
import ReconnectingWebSocket from 'partysocket/ws';
import { create } from 'zustand';
import { roomSocketUrl } from '../api/room.js';
import {
  aimFeedback,
  captureFeedback,
  rejectFeedback,
  stoneFeedback,
} from '../telegram/feedback.js';

export type Connection = 'idle' | 'connecting' | 'online' | 'offline';

export interface FinalScore {
  black: number;
  white: number;
}

interface OnlineStore {
  roomId: string | null;
  connection: Connection;
  settings: GameSettings | null;
  status: RoomStatus;
  seats: Seat[];
  online: SeatColor[];
  yourColor: SeatColor | null;
  result: string | null;
  score: FinalScore | null;

  clock: Clock | null;
  /** Насколько часы браузера убежали от часов комнаты, мс. */
  clockOffset: number;
  scoring: Scoring | null;

  game: GameState | null;
  /** Ходы по порядку — из них собирается SGF для архива. */
  record: RecordedMove[];
  /** Номер последнего применённого хода. Он же уезжает в join при реконнекте. */
  lastSeq: number;
  /** Последний номер, который подтвердила комната. Свой ход его не двигает. */
  ackSeq: number;
  lastMove: number | null;
  pending: number | null;
  /** Ход отправлен и показан оптимистично, подтверждения ещё нет. */
  awaiting: number | null;
  rejected: number | null;
  notice: string | null;

  connect: (roomId: string) => void;
  leave: () => void;
  aim: (point: number) => void;
  clearAim: () => void;
  confirmMove: () => void;
  pass: () => void;
  resign: () => void;
  toggleDead: (point: number) => void;
  acceptScore: () => void;
  resumeGame: () => void;
}

/** Сокет живёт вне стора: он не состояние, а канал, и в рендере не участвует. */
let socket: ReconnectingWebSocket | null = null;

/** Сколько ждём подтверждения хода, прежде чем считать соединение мёртвым. */
const DELIVERY_TIMEOUT_MS = 3000;
let deliveryTimer: ReturnType<typeof setTimeout> | null = null;

function stopWatching(): void {
  if (deliveryTimer !== null) clearTimeout(deliveryTimer);
  deliveryTimer = null;
}

/**
 * Присмотр за отправленным ходом.
 *
 * Мёртвый сокет браузер замечает не сразу: на мобильной сети он молча глотает
 * кадры, пока не истечёт таймаут TCP, — а часы в комнате всё это время идут,
 * и партию можно проиграть по времени, глядя на «в сети». Ход без ответа за
 * три секунды — достаточный повод переподключиться самим: комната ответит
 * полным состоянием, и станет видно, дошёл ход или нет.
 */
function watchDelivery(seq: number, set: Setter, get: Getter): void {
  stopWatching();
  deliveryTimer = setTimeout(() => {
    deliveryTimer = null;
    if (get().ackSeq >= seq) return;
    set({ notice: 'Ход не доходит до комнаты — восстанавливаем связь' });
    socket?.reconnect();
  }, DELIVERY_TIMEOUT_MS);
}

const IDLE = {
  roomId: null,
  connection: 'idle' as Connection,
  settings: null,
  status: 'waiting' as RoomStatus,
  seats: [] as Seat[],
  online: [] as SeatColor[],
  yourColor: null,
  result: null,
  score: null,
  clock: null,
  clockOffset: 0,
  scoring: null,
  game: null,
  record: [] as RecordedMove[],
  lastSeq: 0,
  ackSeq: 0,
  lastMove: null,
  pending: null,
  awaiting: null,
  rejected: null,
  notice: null,
};

export const useOnlineStore = create<OnlineStore>((set, get) => ({
  ...IDLE,

  connect: (roomId) => {
    if (socket) socket.close();
    set({ ...IDLE, roomId, connection: 'connecting' });

    // URL считается функцией, а не строкой: на каждое переподключение нужна
    // свежая initData, иначе после долгой паузы комната отвергнет подпись.
    socket = new ReconnectingWebSocket(() => roomSocketUrl(roomId));

    socket.addEventListener('open', () => {
      set({ connection: 'online' });
      sendMessage({ type: 'join', lastSeq: get().lastSeq });
    });

    socket.addEventListener('close', () => set({ connection: 'offline' }));

    socket.addEventListener('message', (event: MessageEvent<string>) => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = ServerMessageSchema.safeParse(payload);
      if (!parsed.success) return;
      handleServerMessage(parsed.data, set, get);
      alignPhase(set, get);
    });
  },

  leave: () => {
    stopWatching();
    socket?.close();
    socket = null;
    set({ ...IDLE });
  },

  aim: (point) => {
    const { game, yourColor, status, pending, awaiting } = get();
    if (!game || status !== 'playing' || !yourColor) return;
    if (awaiting !== null) return;
    if (seatOf(game.toPlay) !== yourColor) return;

    if (pending === point) {
      get().confirmMove();
      return;
    }

    const result = play(game, { type: 'play', ...coords(game, point) });
    if (!result.ok) {
      rejectFeedback();
      set({ pending: null, rejected: point, notice: illegalText(result.reason) });
      return;
    }

    aimFeedback();
    set({ pending: point, rejected: null, notice: null });
  },

  clearAim: () => set({ pending: null, rejected: null, notice: null }),

  confirmMove: () => {
    const { game, pending, lastSeq } = get();
    if (!game || pending === null) return;

    const result = play(game, { type: 'play', ...coords(game, pending) });
    if (!result.ok) {
      rejectFeedback();
      set({ pending: null, rejected: pending, notice: illegalText(result.reason) });
      return;
    }

    // Ход показывается сразу, не дожидаясь комнаты: на мобильной сети
    // задержка подтверждения заметна пальцами. Судья всё равно комната —
    // если она не согласится, придёт полное состояние и картинка выправится.
    feedbackFor(game, result.value);
    set({
      game: result.value,
      record: [...get().record, { color: game.toPlay, move: { type: 'play', ...coords(game, pending) } }],
      lastSeq: lastSeq + 1,
      lastMove: pending,
      pending: null,
      awaiting: pending,
      rejected: null,
      notice: null,
    });

    sendMessage({ type: 'move', seq: lastSeq + 1, ...coords(game, pending) });
    watchDelivery(lastSeq + 1, set, get);
  },

  // Пас оптимистично не показывается: он может закончить партию, и рисовать
  // это до ответа комнаты не стоит.
  pass: () => {
    const { game, status, yourColor, lastSeq } = get();
    if (!game || status !== 'playing' || !yourColor) return;
    if (seatOf(game.toPlay) !== yourColor) return;
    set({ pending: null, rejected: null, notice: null });
    sendMessage({ type: 'pass', seq: lastSeq + 1 });
    watchDelivery(lastSeq + 1, set, get);
  },

  resign: () => sendMessage({ type: 'resign' }),

  toggleDead: (point) => {
    if (get().status !== 'scoring') return;
    aimFeedback();
    sendMessage({ type: 'scoring:toggle', point });
  },

  acceptScore: () => sendMessage({ type: 'scoring:accept' }),

  resumeGame: () => sendMessage({ type: 'scoring:resume' }),
}));

type Setter = (partial: Partial<OnlineStore>) => void;
type Getter = () => OnlineStore;

/**
 * Возврат из подсчёта («доиграть») отдельным ходом не записывается: о нём
 * говорит только статус комнаты. Держим позицию в согласии со статусом —
 * иначе движок на клиенте отвергает любой ход как «сейчас не игра», и после
 * «доиграть» партия встаёт намертво.
 */
function alignPhase(set: Setter, get: Getter): void {
  const { game, status } = get();
  if (!game || status !== 'playing' || game.phase !== 'scoring') return;
  set({ game: resumePlay(game) });
}

function handleServerMessage(
  message: ReturnType<typeof ServerMessageSchema.parse>,
  set: Setter,
  get: Getter,
): void {
  switch (message.type) {
    case 'state': {
      const replayed = replay(message.settings, message.moves);
      set({
        settings: message.settings,
        status: message.status,
        seats: message.seats,
        online: message.online,
        yourColor: message.yourColor,
        result: message.result,
        scoring: message.scoring,
        game: replayed.game,
        record: replayed.record,
        lastSeq: replayed.lastSeq,
        ackSeq: replayed.lastSeq,
        lastMove: replayed.lastMove,
        pending: null,
        awaiting: null,
        rejected: null,
        ...clockPatch(message.clock),
      });
      return;
    }

    case 'sync': {
      set({
        status: message.status,
        seats: message.seats,
        online: message.online,
        yourColor: message.yourColor,
        result: message.result,
        scoring: message.scoring,
        ...clockPatch(message.clock),
      });
      for (const move of message.moves) applyMove(move, set, get);

      // Дельту комната шлёт только с номера, который у неё уже есть, — значит,
      // наш неподтверждённый ход до неё доехал. Без этого `awaiting` зависал
      // навсегда: часы на экране продолжали течь с нас, а прицелиться заново
      // было нельзя вовсе.
      set({ awaiting: null, ackSeq: get().lastSeq });
      return;
    }

    case 'move': {
      set({ status: message.status, ...clockPatch(message.clock) });
      applyMove(message.move, set, get);
      return;
    }

    case 'clock':
      set(clockPatch(message.clock));
      return;

    case 'scoring':
      set({ status: message.status, scoring: message.scoring, pending: null, rejected: null });
      return;

    case 'over':
      set({
        status: 'finished',
        result: message.result,
        scoring: message.scoring,
        score: message.score,
        pending: null,
        awaiting: null,
      });
      return;

    case 'presence':
      set({ online: message.online, seats: message.seats, status: message.status });
      return;

    case 'error':
      // Рассинхрон комната чинит сама, прислав состояние следом. Здесь только
      // текст для игрока — и снятие оптимистичного хода, чтобы доска не врала.
      stopWatching();
      set({ awaiting: null, notice: message.message });
      return;
  }
}

/** Разница часов считается по каждому сообщению: соединение может и мигать. */
function clockPatch(clock: Clock): Partial<OnlineStore> {
  return { clock, clockOffset: Date.now() - clock.serverNow };
}

function applyMove(move: MoveRecord, set: Setter, get: Getter): void {
  const { game, lastSeq, awaiting } = get();
  if (!game) return;

  // Свой же ход, показанный оптимистично: комната его подтвердила.
  if (move.seq === lastSeq && awaiting !== null) {
    set({ awaiting: null, ackSeq: move.seq });
    return;
  }
  if (move.seq !== lastSeq + 1) return;

  const base = resumePlay(game);
  const result = play(base, toEngineMove(move));
  if (!result.ok) return;

  if (move.type === 'play') feedbackFor(base, result.value);
  set({
    game: result.value,
    record: [...get().record, { color: base.toPlay, move: toEngineMove(move) }],
    lastSeq: move.seq,
    ackSeq: move.seq,
    lastMove: move.type === 'play' ? move.y! * game.size + move.x! : null,
    awaiting: null,
    pending: null,
    rejected: null,
    notice: null,
  });
}

function replay(
  settings: GameSettings,
  moves: MoveRecord[],
): { game: GameState; record: RecordedMove[]; lastSeq: number; lastMove: number | null } {
  let game = createGame({
    size: settings.size,
    komi: settings.komi,
    handicap: settings.handicap,
  });
  const record: RecordedMove[] = [];
  let lastMove: number | null = null;
  let lastSeq = 0;

  for (const move of moves) {
    // Ход после двух пасов — продолжение после «доиграть».
    const base = resumePlay(game);
    const result = play(base, toEngineMove(move));
    if (!result.ok) break;
    record.push({ color: base.toPlay, move: toEngineMove(move) });
    game = result.value;
    lastMove = move.type === 'play' ? move.y! * settings.size + move.x! : null;
    lastSeq = move.seq;
  }

  return { game, record, lastSeq, lastMove };
}

function toEngineMove(move: MoveRecord) {
  if (move.type === 'play') return { type: 'play' as const, x: move.x!, y: move.y! };
  return move.type === 'pass' ? { type: 'pass' as const } : { type: 'resign' as const };
}

function sendMessage(message: ClientMessage): void {
  socket?.send(JSON.stringify(message));
}

function coords(game: GameState, point: number): { x: number; y: number } {
  return { x: point % game.size, y: (point / game.size) | 0 };
}

function feedbackFor(before: GameState, after: GameState): void {
  const captured =
    after.capturedByBlack -
    before.capturedByBlack +
    (after.capturedByWhite - before.capturedByWhite);
  if (captured > 0) captureFeedback();
  else stoneFeedback();
}

export function seatOf(color: Color): SeatColor {
  return color === BLACK ? 'black' : 'white';
}

export function engineColorOf(seat: SeatColor): Color {
  return seat === 'black' ? BLACK : WHITE;
}

function illegalText(reason: string): string {
  switch (reason) {
    case 'occupied':
      return 'Пункт занят';
    case 'suicide':
      return 'Самоубийство запрещено';
    case 'ko':
      return 'Ко: сюда нельзя сразу';
    case 'superko':
      return 'Позиция уже встречалась';
    default:
      return 'Так нельзя';
  }
}
