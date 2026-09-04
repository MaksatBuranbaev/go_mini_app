/**
 * Звук доски.
 *
 * Файлов нет намеренно: два коротких стука синтезируются на месте, и бандл
 * не тащит ни килобайта аудио. Контекст создаётся лениво — из тапа, которым
 * ставят камень: до первого жеста браузер всё равно не даст ничего сыграть.
 */
const STORAGE_KEY = 'go_sound';

let context: AudioContext | null = null;
let enabled = readPreference();

function readPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    // Приватный режим без хранилища: настройка проживёт до перезагрузки.
  }
}

type AudioContextCtor = typeof AudioContext;

function audio(): AudioContext | null {
  if (!enabled) return null;

  if (!context) {
    const ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!ctor) return null;
    try {
      context = new ctor();
    } catch {
      return null;
    }
  }

  // Ход соперника приходит без всякого жеста, и контекст может спать.
  if (context.state === 'suspended') void context.resume().catch(() => {});
  return context;
}

/** Один стук: короткий тон с быстрым затуханием — камень о дерево. */
function knock(frequency: number, volume: number, delay = 0): void {
  const ctx = audio();
  if (!ctx) return;

  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.6, start + 0.09);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);

  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.1);
}

/** Камень встал на доску. */
export function stoneSound(): void {
  knock(320, 0.18);
}

/** Взяли группу: тот же стук плюс сухой отзвук снятых камней. */
export function captureSound(): void {
  knock(320, 0.18);
  knock(180, 0.14, 0.07);
}
