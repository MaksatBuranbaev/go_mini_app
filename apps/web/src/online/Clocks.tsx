import type { Clock, SeatColor, TimeControl } from '@go/protocol';
import { useEffect, useState } from 'react';

export interface ClocksProps {
  clock: Clock;
  time: TimeControl;
  /** Чьи часы сейчас идут. `null` — часы стоят. */
  running: SeatColor | null;
  yourColor: SeatColor | null;
  /** Насколько часы устройства убежали от серверных, в миллисекундах. */
  offset: number;
}

/**
 * Часы обоих игроков.
 *
 * Комната присылает показания вместе с каждым ходом, между ходами клиент
 * досчитывает сам — поэтому по сети не гоняется ни одного лишнего пакета
 * на тиканье секунд. Расхождение системных часов снимается через `serverNow`.
 */
export function Clocks({ clock, time, running, yourColor, offset }: ClocksProps) {
  const tick = useSecondTick(running !== null);

  if (time.type === 'none') return null;

  return (
    <div className="clocks">
      {(['black', 'white'] as const).map((color) => (
        <div
          key={color}
          className={[
            'clock',
            running === color ? 'clock-active' : '',
            color === yourColor ? 'clock-mine' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className={`clock-dot clock-dot-${color}`} />
          {formatSide(clock, time, color, running === color ? tick - offset : null)}
        </div>
      ))}
    </div>
  );
}

/** Перерисовка раз в секунду — только пока часы идут. */
function useSecondTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const beat = () => setNow(Date.now());
    const id = setInterval(beat, 500);
    // Свёрнутому мини-аппу браузер режет таймеры вплоть до раза в минуту:
    // при возврате пересчитываем сразу, иначе игрок видит замершие показания.
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [active]);

  return now;
}

function formatSide(
  clock: Clock,
  time: TimeControl,
  color: SeatColor,
  /** Серверное «сейчас», уже сдвинутое на расхождение часов. `null` — часы стоят. */
  serverNow: number | null,
): string {
  if (time.type === 'none') return '';

  const stored = color === 'black' ? clock.blackMs : clock.whiteMs;
  const periods = color === 'black' ? clock.blackPeriods : clock.whitePeriods;

  // Убегает время только у того, чей сейчас ход.
  const elapsed =
    serverNow !== null && clock.lastMoveAt !== null ? Math.max(0, serverNow - clock.lastMoveAt) : 0;

  if (time.type === 'fischer') return clockText(Math.max(0, stored - elapsed));

  if (stored > elapsed) return clockText(stored - elapsed);

  // Основное время кончилось: считаем, сколько периодов уже сгорело.
  const overflow = elapsed - stored;
  const burned = Math.floor(overflow / time.periodMs);
  const left = Math.max(0, periods - burned);
  if (left === 0) return '00:00';

  const insidePeriod = time.periodMs - (overflow % time.periodMs);
  return `${Math.ceil(insidePeriod / 1000)} с × ${left}`;
}

function clockText(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
