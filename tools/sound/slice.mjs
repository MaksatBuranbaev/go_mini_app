/**
 * Нарезка сэмплов стука камня из записи с freesound.
 *
 * В записи два десятка ударов подряд; приложению нужны несколько чистых,
 * выровненных по громкости и уложенных в один файл — так браузер декодирует
 * его один раз, а играет разные удары по смещению.
 *
 * Декодирует mp3 сам браузер: ffmpeg в окружении нет, а Edge для сквозных
 * прогонов и так поднят. Node только считает WAV из готовых отсчётов.
 *
 *   node tools/sound/slice.mjs            # разбор: какие удары нашлись
 *   node tools/sound/slice.mjs 1,4,7,9    # собрать спрайт из этих ударов
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Tab } from '../../tests/lib/tab.mjs';

const SOURCE = 'tools/sound/840425__hongsungbock__baduk2.mp3';
const TARGET = 'apps/web/src/assets/stones.wav';

/** Длина ячейки спрайта. Должна совпадать с `SLOT_MS` в `telegram/sound.ts`. */
const SLOT_MS = 130;
const RATE = 44100;

const picks = process.argv[2] ? process.argv[2].split(',').map(Number) : null;

const analyse = (b64, slotMs, rate, picks) => `(async () => {
  const bin = atob(${JSON.stringify(b64)});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  // Декодируем сразу в нужную частоту: OfflineAudioContext пересчитает сам.
  const ctx = new OfflineAudioContext(1, ${rate}, ${rate});
  const decoded = await ctx.decodeAudioData(bytes.buffer);

  const n = decoded.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += data[i] / decoded.numberOfChannels;
  }
  let top = 0;
  for (let i = 0; i < n; i++) top = Math.max(top, Math.abs(mono[i]));
  for (let i = 0; i < n; i++) mono[i] /= top || 1;

  // Огибающая по коротким окнам: удар — это резкий подъём энергии.
  const win = 128;
  const env = new Float32Array(Math.floor(n / win));
  for (let w = 0; w < env.length; w++) {
    let sum = 0;
    for (let i = 0; i < win; i++) {
      const v = mono[w * win + i];
      sum += v * v;
    }
    env[w] = Math.sqrt(sum / win);
  }

  const perMs = ${rate} / 1000 / win;
  const onsets = [];
  for (let w = 2; w < env.length; w++) {
    if (env[w] < 0.05) continue;
    if (env[w] < env[w - 1] * 2.5) continue;
    const last = onsets[onsets.length - 1];
    if (last !== undefined && (w - last) < 120 * perMs) continue;
    onsets.push(w);
  }

  const slot = Math.round(${slotMs} / 1000 * ${rate});
  const found = onsets.map((w) => {
    const start = Math.max(0, w * win - Math.round(0.002 * ${rate}));
    let peak = 0;
    for (let i = start; i < Math.min(n, start + slot); i++) peak = Math.max(peak, Math.abs(mono[i]));
    let before = 0;
    for (let i = Math.max(0, start - 1764); i < start; i++) before = Math.max(before, Math.abs(mono[i]));
    // Хвост: где удар затих настолько, что дальше только шум.
    let tail = slot;
    for (let w2 = w + 1; w2 < env.length && (w2 - w) < slot / win; w2++) {
      if (env[w2] < 0.01) { tail = (w2 - w) * win; break; }
    }
    return { at: +(start / ${rate}).toFixed(3), peak: +peak.toFixed(3), before: +before.toFixed(3), tail, start };
  });

  const picks = ${JSON.stringify(picks)};
  if (!picks) return { rate: decoded.sampleRate, duration: decoded.duration, found: found.map(({ start, ...rest }) => rest) };

  // Спрайт: каждый удар в своей ячейке, выровнен по громкости, с коротким
  // спадом в конце — иначе обрыв сам щёлкает.
  const out = new Int16Array(slot * picks.length);
  picks.forEach((index, cell) => {
    const chosen = found[index];
    if (!chosen) throw new Error('нет удара № ' + index);
    let peak = 0;
    for (let i = 0; i < slot; i++) peak = Math.max(peak, Math.abs(mono[chosen.start + i] || 0));
    const gain = 0.89 / (peak || 1);
    const fade = Math.round(0.02 * ${rate});
    for (let i = 0; i < slot; i++) {
      let v = (mono[chosen.start + i] || 0) * gain;
      if (i < 32) v *= i / 32;
      if (i > slot - fade) v *= (slot - i) / fade;
      out[cell * slot + i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    }
  });

  let binary = '';
  const raw = new Uint8Array(out.buffer);
  for (let i = 0; i < raw.length; i += 8192) {
    binary += String.fromCharCode.apply(null, raw.subarray(i, i + 8192));
  }
  return { rate: decoded.sampleRate, duration: decoded.duration, slot, pcm: btoa(binary) };
})()`;

const tab = await Tab.open('slice', 'about:blank');
const result = await tab.evaluate(
  analyse(readFileSync(SOURCE).toString('base64'), SLOT_MS, RATE, picks),
);

if (!picks) {
  console.log(`запись: ${result.duration.toFixed(2)} с, ${result.rate} Гц`);
  console.log('№  время   пик   фон   хвост');
  result.found.forEach((hit, index) => {
    console.log(
      `${String(index).padStart(2)} ${String(hit.at).padStart(6)}  ${hit.peak}  ${hit.before}  ${hit.tail}`,
    );
  });
  console.log('\nвыбрать: node tools/sound/slice.mjs 1,4,7');
  process.exit(0);
}

const pcm = Buffer.from(result.pcm, 'base64');
writeFileSync(TARGET, wav(pcm, RATE));
console.log(`${TARGET}: ${picks.length} ударов по ${SLOT_MS} мс, ${(pcm.length / 1024).toFixed(1)} КиБ`);
process.exit(0);

/** Заголовок WAV: моно, 16 бит. */
function wav(pcm, rate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
