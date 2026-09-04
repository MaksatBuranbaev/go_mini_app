/**
 * Звук доски.
 *
 * Стучит настоящая запись: пять ударов камня, нарезанных в один файл
 * (`tools/sound/slice.mjs`), из которого каждый ход берётся случайный — иначе
 * серия ходов превращается в метроном. Файл грузится лениво, первым тапом:
 * до жеста браузер всё равно ничего не сыграет, а пока он не декодирован,
 * звучит синтез. Синтез же остаётся и запасным путём — если файл не доехал
 * или WebView не осилил декодирование, стук просто становится беднее.
 */
import stonesUrl from '../assets/stones.wav?url';

const STORAGE_KEY = 'go_sound';

/** Длина ячейки спрайта. Должна совпадать с `SLOT_MS` в `tools/sound/slice.mjs`. */
const SLOT = 0.13;

let context: AudioContext | null = null;
let stones: AudioBuffer | null = null;
let loading = false;
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
  load(context);
  return context;
}

/** Запись подтягивается один раз и только когда звук уже понадобился. */
function load(ctx: AudioContext): void {
  if (stones || loading) return;
  loading = true;
  void fetch(stonesUrl)
    .then((response) => response.arrayBuffer())
    .then((data) => ctx.decodeAudioData(data))
    .then((buffer) => {
      stones = buffer;
    })
    .catch(() => {
      // Остаёмся на синтезе. Повторять попытку незачем: файл лежит рядом с
      // приложением, и если его нет сейчас, не появится и через ход.
    });
}

const vary = (value: number, spread: number) => value * (1 + (Math.random() * 2 - 1) * spread);

/** Удар камня о доску: случайный из записи, чуть разный по высоте и силе. */
function knock(ctx: AudioContext, at: number, volume: number): void {
  if (!stones) {
    click(ctx, at, 1700, volume * 0.4);
    body(ctx, at, 230, volume * 0.3);
    return;
  }

  const count = Math.max(1, Math.round(stones.duration / SLOT));
  const source = ctx.createBufferSource();
  source.buffer = stones;
  source.playbackRate.value = vary(1, 0.03);

  const gain = ctx.createGain();
  gain.gain.value = vary(volume, 0.1);

  source.connect(gain).connect(ctx.destination);
  source.start(at, Math.floor(Math.random() * count) * SLOT, SLOT);
}

/** Полсекунды белого шума: заготовка для синтезированных щелчков. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise) return noise;
  const frames = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  noise = buffer;
  return buffer;
}

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
  knock(ctx, ctx.currentTime, 0.5);
}

/** Взяли группу: стук и следом сгребённые в чашу камни. */
export function captureSound(): void {
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime;
  knock(ctx, at, 0.5);
  for (let i = 0; i < 3; i++) knock(ctx, at + 0.07 + Math.random() * 0.09 * (i + 1), 0.22);
}
