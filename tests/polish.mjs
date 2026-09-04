// Синхронизация двух игроков и часы во время отправки хода.
import { check, report, sleep } from './lib/harness.mjs';
import { Tab } from './lib/tab.mjs';

/** Считаем источники звука: он синтезируется, файлов для проверки нет. */
const SPY = `
  // Прошлый прогон мог выключить звук — сбрасываем настройку один раз,
  // иначе перезагрузка внутри теста затрёт то, что тест и проверяет.
  try {
    if (!sessionStorage.getItem('sound_reset')) {
      localStorage.removeItem('go_sound');
      sessionStorage.setItem('sound_reset', '1');
    }
  } catch {}
  window.__osc = 0;
  const RealCtx = window.AudioContext;
  window.AudioContext = class extends RealCtx {
    createOscillator() { window.__osc++; return super.createOscillator(); }
    createBufferSource() { window.__osc++; return super.createBufferSource(); }
  };
`;

const a = await Tab.open('A', 'about:blank');
await a.send('Page.addScriptToEvaluateOnNewDocument', { source: SPY });
await a.send('Page.navigate', { url: 'http://localhost:5173/?dev_user=81' });
await sleep(2800);

await a.clickText('Чёрные');
await a.clickText('Пригласить друга');
const link = await a.waitForText('.invite-link', (t) => t.includes('startapp='));
const roomId = decodeURIComponent(link.split('startapp=')[1]);
console.log('комната:', roomId);

const b = await Tab.open('B', `http://localhost:5173/?dev_user=82&startapp=${encodeURIComponent(roomId)}`);
await sleep(2800);
await b.clickText('Принять');
await a.waitForText('.status-main', (t) => t.includes('Ваш ход'));

console.log('--- звук ---');
await a.tap(4, 4);
await b.waitForText('.status-main', (t) => t.includes('Ваш ход'));
await sleep(400);
const afterMove = await a.evaluate('window.__osc');
check('ход звучит', afterMove >= 2, `источников ${afterMove}`);

console.log('--- анимация захвата ---');
// Белый камень в углу теряет свободы одну за другой: снимает его последний
// ход чёрных, и измеряем мы именно его.
for (const [who, x, y] of [
  [b, 0, 0],
  [a, 1, 0],
  [b, 8, 8],
]) {
  await who.waitForText('.status-main', (t) => t.includes('Ваш ход'));
  await who.tap(x, y);
  await sleep(500);
}

await a.waitForText('.status-main', (t) => t.includes('Ваш ход'));
const oscBefore = await a.evaluate('window.__osc');
await a.send('Page.bringToFront');
await a.tap(0, 1);
await sleep(60);
const during = await a.evaluate(`document.querySelector('canvas').toDataURL()`);
await sleep(700);
const after = await a.evaluate(`document.querySelector('canvas').toDataURL()`);
check('во время захвата доска ещё меняется', during !== after);
await sleep(400);
check('анимация заканчивается', (await a.evaluate(`document.querySelector('canvas').toDataURL()`)) === after);

const oscAfter = await a.evaluate('window.__osc');
check('захват звучит богаче хода', oscAfter - oscBefore >= 5, `источников ${oscAfter - oscBefore}`);

// И у соперника снятый камень тоже пропал.
await b.waitForText('.status-main', (t) => t.includes('Ваш ход'));
await sleep(500);
check('доски сошлись после захвата', (await b.boardImage()) === (await a.boardImage()));
await a.shot('80-capture');

console.log('--- выключение звука ---');
await a.evaluate("localStorage.setItem('go_sound', 'off')");
await a.send('Page.reload');
await sleep(3000);
const setting = await a.evaluate("localStorage.getItem('go_sound')");
check('настройка звука сохраняется', setting === 'off', String(setting));
await a.evaluate("localStorage.setItem('go_sound', 'on')");

report([a, b]);
