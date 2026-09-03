import { useEffect } from 'react';
import { GameScreen } from './game/GameScreen.js';
import { useGameStore } from './game/store.js';
import { LobbyScreen } from './lobby/LobbyScreen.js';
import { useRoomStore } from './store/room.js';

export function App() {
  const game = useGameStore((state) => state.game);
  const ping = useRoomStore((state) => state.ping);

  useEffect(() => {
    void ping();
  }, [ping]);

  return game ? <GameScreen /> : <LobbyScreen />;
}
