import type { RoomPong } from '@go/protocol';
import { create } from 'zustand';
import { pingRoom } from '../api/room.js';

type Status = 'idle' | 'pinging' | 'ok' | 'error';

interface RoomStore {
  roomId: string;
  status: Status;
  pong: RoomPong | null;
  error: string | null;
  setRoomId: (roomId: string) => void;
  ping: () => Promise<void>;
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  roomId: '',
  status: 'idle',
  pong: null,
  error: null,

  setRoomId: (roomId) => set({ roomId, status: 'idle', pong: null, error: null }),

  ping: async () => {
    const { roomId } = get();
    if (!roomId) return;
    set({ status: 'pinging', error: null });
    try {
      set({ status: 'ok', pong: await pingRoom(roomId) });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
