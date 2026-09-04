import {
  BLACK,
  WHITE,
  createGame,
  play,
  type Color,
  type GameState,
} from '@go/engine';
import {
  ServerMessageSchema,
  type ClientMessage,
  type GameSettings,
  type MoveRecord,
  type RoomStatus,
  type Seat,
  type SeatColor,
} from '@go/protocol';
import ReconnectingWebSocket from 'partysocket/ws';
import { create } from 'zustand';
import { roomSocketUrl } from '../api/room.js';
import { aimFeedback, captureFeedback, rejectFeedback, stoneFeedback } from '../telegram/feedback.js';

export type Connection = 'idle' | 'connecting' | 'online' | 'offline';

interface OnlineStore {
  roomId: string | null;
  connection: Connection;
  settings: GameSettings | null;
  status: RoomStatus;
  seats: Seat[];
  online: SeatColor[];
  yourColor: SeatColor | null;
  result: string | null;

  game: GameState | null;
  /** Номер последнего применённого хода. Он же уезжает в join при реконнекте. */
  lastSeq: number;
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
}

/** Сокет живёт вне стора: он не состояние, а канал, и в рендере не участвует. */
let socket: ReconnectingWebSocket | null = null;

const IDLE = {
  roomId: null,
  connection: 'idle' as Connection,
  settings: null,
  status: 'waiting' as RoomStatus,
  seats: [] as Seat[],
  online: [] as SeatColor[],
  yourColor: null,
  result: null,
  game: null,
  lastSeq: 0,
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

    socket.addEventListener('close', () => {
      set({ connection: 'offline' });
    });

    socket.addEventListener('message', (event: MessageEvent<string>) => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = ServerMessageSchema.safeParse(payload);
      if (parsed.success) handleServerMessage(parsed.data, set, get);
    });
  },

  leave: () => {
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
      lastSeq: lastSeq + 1,
      lastMove: pending,
      pending: null,
      awaiting: pending,
      rejected: null,
      notice: null,
    });

    sendMessage({ type: 'move', seq: lastSeq + 1, ...coords(game, pending) });
  },
}));

type Setter = (partial: Partial<OnlineStore>) => void;
type Getter = () => OnlineStore;

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
        game: replayed.game,
        lastSeq: replayed.lastSeq,
        lastMove: replayed.lastMove,
        pending: null,
        awaiting: null,
        rejected: null,
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
      });
      for (const move of message.moves) applyMove(move, set, get);
      return;
    }

    case 'move': {
      set({ status: message.status });
      applyMove(message.move, set, get);
      return;
    }

    case 'presence':
      set({ online: message.online, seats: message.seats, status: message.status });
      return;

    case 'error': {
      // Рассинхрон комната чинит сама, прислав состояние следом. Здесь только
      // текст для игрока — и снятие оптимистичного хода, чтобы доска не врала.
      set({ awaiting: null, notice: message.message });
      return;
    }
  }
}

function applyMove(move: MoveRecord, set: Setter, get: Getter): void {
  const { game, lastSeq, awaiting } = get();
  if (!game) return;

  // Свой же ход, показанный оптимистично: комната его подтвердила.
  if (move.seq === lastSeq && awaiting !== null) {
    set({ awaiting: null });
    return;
  }
  if (move.seq !== lastSeq + 1) return;

  if (move.type !== 'play' || move.x === undefined || move.y === undefined) return;

  const result = play(game, { type: 'play', x: move.x, y: move.y });
  if (!result.ok) return;

  feedbackFor(game, result.value);
  set({
    game: result.value,
    lastSeq: move.seq,
    lastMove: move.y * game.size + move.x,
    awaiting: null,
    pending: null,
    rejected: null,
    notice: null,
  });
}

function replay(
  settings: GameSettings,
  moves: MoveRecord[],
): { game: GameState; lastSeq: number; lastMove: number | null } {
  let game = createGame({
    size: settings.size,
    komi: settings.komi,
    handicap: settings.handicap,
  });
  let lastMove: number | null = null;
  let lastSeq = 0;

  for (const move of moves) {
    if (move.type !== 'play' || move.x === undefined || move.y === undefined) continue;
    const result = play(game, { type: 'play', x: move.x, y: move.y });
    if (!result.ok) break;
    game = result.value;
    lastMove = move.y * settings.size + move.x;
    lastSeq = move.seq;
  }

  return { game, lastSeq, lastMove };
}

function sendMessage(message: ClientMessage): void {
  socket?.send(JSON.stringify(message));
}

function coords(game: GameState, point: number): { x: number; y: number } {
  return { x: point % game.size, y: (point / game.size) | 0 };
}

function feedbackFor(before: GameState, after: GameState): void {
  const captured =
    after.capturedByBlack - before.capturedByBlack + (after.capturedByWhite - before.capturedByWhite);
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
