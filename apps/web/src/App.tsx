import type { GameSettings, SeatColor } from '@go/protocol';
import { isMiniAppDark, useSignal } from '@telegram-apps/sdk-react';
import { useEffect, useState } from 'react';
import { ArchiveScreen } from './archive/ArchiveScreen.js';
import { ReviewScreen } from './archive/ReviewScreen.js';
import { GameScreen } from './game/GameScreen.js';
import { useGameStore } from './game/store.js';
import { LobbyScreen } from './lobby/LobbyScreen.js';
import { JoinScreen } from './online/JoinScreen.js';
import { RoomScreen } from './online/RoomScreen.js';
import { restoreRoom } from './online/session.js';
import { startParam } from './telegram/init.js';

/**
 * Экранов мало и они не вложены, так что маршрутизатор здесь — это одно
 * состояние. Партия на одном устройстве живёт отдельным стором и перекрывает
 * всё остальное, пока не закончится.
 */
type Route =
  | { view: 'lobby' }
  | { view: 'join'; roomId: string }
  | { view: 'room'; roomId: string; settings: GameSettings; expected?: SeatColor | null }
  | { view: 'archive' }
  | { view: 'review'; id: string };

export function App() {
  const hotseat = useGameStore((state) => state.game);

  // Тему Telegram отдаёт переменными, но CSS нужен и сам факт «темно сейчас»:
  // подложки и тени в светлой и тёмной теме считаются по-разному.
  const isDark = useSignal(isMiniAppDark);
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  }, [isDark]);

  const [route, setRoute] = useState<Route>(() => {
    // Открыли по ссылке-приглашению — сразу показываем, во что зовут.
    const param = startParam();
    if (param) return { view: 'join', roomId: param };

    // Иначе возвращаемся в комнату, из которой нас вынесло перезагрузкой.
    const stored = restoreRoom();
    return stored ? { view: 'room', ...stored } : { view: 'lobby' };
  });

  if (hotseat) return <GameScreen />;

  switch (route.view) {
    case 'join':
      return (
        <JoinScreen
          roomId={route.roomId}
          onAccept={(settings, expected) =>
            setRoute({ view: 'room', roomId: route.roomId, settings, expected })
          }
          onCancel={() => setRoute({ view: 'lobby' })}
        />
      );

    case 'room':
      return (
        <RoomScreen
          roomId={route.roomId}
          settings={route.settings}
          expected={route.expected ?? null}
          onLeave={() => setRoute({ view: 'lobby' })}
        />
      );

    case 'archive':
      return (
        <ArchiveScreen
          onOpen={(id) => setRoute({ view: 'review', id })}
          onBack={() => setRoute({ view: 'lobby' })}
        />
      );

    case 'review':
      return <ReviewScreen id={route.id} onBack={() => setRoute({ view: 'archive' })} />;

    case 'lobby':
      return (
        <LobbyScreen
          onCreated={(roomId, settings) => setRoute({ view: 'room', roomId, settings })}
          onArchive={() => setRoute({ view: 'archive' })}
        />
      );
  }
}
