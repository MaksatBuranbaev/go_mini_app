/**
 * Звук доски.
 *
 * Файлов нет намеренно: стук синтезируется на месте, и бандл не тащит ни
 * килобайта аудио. Контекст создаётся лениво — из тапа, которым ставят
 * камень: до первого жеста браузер всё равно не даст ничего сыграть.
 *
 * Стук собран из двух частей, потому что одним тоном камень не звучит:
 * щелчок — короткий шумовой всплеск через резонанс, тело — низкий отзвук
 * дерева. Каждый удар слегка отличается по высоте и громкости, иначе серия
 * ходов превращается в метроном.
 */
const STORAGE_KEY = 'go_sound';

let context: AudioContext | null = null;
let noise: AudioBuffer | null = null;
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

/** Полсекунды белого шума: заготовка для щелчков, считается один раз. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise) return noise;
  const frames = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  noise = buffer;
  return buffer;
}

const vary = (value: number, spread: number) => value * (1 + (Math.random() * 2 - 1) * spread);

/** Щелчок: шум через узкий резонанс — так стучит твёрдое о твёрдое. */
function click(ctx: AudioContext, at: number, frequency: number, volume: number): void {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.playbackRate.value = vary(1, 0.1);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = vary(frequency, 0.12);
  filter.Q.value = 7;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.055);

  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(at, Math.random() * 0.4);
  source.stop(at + 0.06);
}

/** Тело: низкий отзвук доски под щелчком. */
function body(ctx: AudioContext, at: number, frequency: number, volume: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(vary(frequency, 0.06), at);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.55, at + 0.08);

  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.085);

  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + 0.09);
}

/** Камень встал на доску. */
export function stoneSound(): void {
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime;
  click(ctx, at, 1700, 0.22);
  body(ctx, at, 230, 0.16);
}

/** Взяли группу: стук и следом сгребённые камни. */
export function captureSound(): void {
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime;
  click(ctx, at, 1700, 0.22);
  body(ctx, at, 230, 0.16);

  // Несколько щелчков вразнобой — камни ссыпаются в чашу.
  for (let i = 0; i < 3; i++) {
    click(ctx, at + 0.06 + Math.random() * 0.08 * (i + 1), 2200, 0.1);
  }
}
