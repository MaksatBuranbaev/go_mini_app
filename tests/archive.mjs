// Архив партий: партия доигрывается до конца, попадает в список и листается
import { check, report, sleep } from './lib/harness.mjs';
import { Tab } from './lib/tab.mjs';

const a = await Tab.open('A', 'http://localhost:5173/?dev_user=41');
await sleep(2800);
await a.evaluate("localStorage.clear(); 'очищено'");
await a.clickText('Чёрные');
await a.clickText('Пригласить друга');
const link = await a.waitForText('.invite-link', (t) => t.includes('startapp='));
const roomId = decodeURIComponent(link.split('startapp=')[1]);
console.log('комната:', roomId);

const b = await Tab.open('B', `http://localhost:5173/?dev_user=42&startapp=${encodeURIComponent(roomId)}`);
await sleep(2800);
await b.clickText('Принять');
await a.waitForText('.status-main', (t) => t.includes('Ваш ход'));

// Короткая партия: по паре камней и два паса.
for (const [who, x, y] of [
  [a, 2, 2],
  [b, 6, 6],
  [a, 2, 6],
  [b, 6, 2],
]) {
  await who.waitForText('.status-main', (t) => t.includes('Ваш ход'));
  await who.tap(x, y);
  await sleep(400);
}

await a.waitForText('.status-main', (t) => t.includes('Ваш ход'));
await a.clickText('Пас');
await sleep(600);
await b.waitForText('.status-main', (t) => t.includes('Ваш ход'));
await b.clickText('Пас');
await a.waitForText('.status-main', (t) => t.includes('мёртвые'));

// Возврат из подсчёта: доигранная часть обязана попасть и на доску, и в запись.
console.log('--- доиграть и закончить снова ---');
await a.clickText('Доиграть');
await a.waitForText('.status-main', (t) => t.includes('ход'));
const beforeExtra = await a.boardImage();
const mover = (await a.text('.status-main'))?.includes('Ваш ход') ? a : b;
const waiter = mover === a ? b : a;
await mover.tap(4, 4);
await waiter.waitForText('.status-main', (t) => t.includes('Ваш ход'));
await sleep(500);
check('ход после «доиграть» появился на доске', (await a.boardImage()) !== beforeExtra);
check('доски игроков сошлись', (await a.boardImage()) === (await b.boardImage()));

await waiter.clickText('Пас');
await sleep(600);
await mover.waitForText('.status-main', (t) => t.includes('Ваш ход'));
await mover.clickText('Пас');
await a.waitForText('.status-main', (t) => t.includes('мёртвые'));

await a.clickText('Принять счёт');
await sleep(400);
await b.clickText('Принять счёт');
await a.waitForText('.status-main', (t) => /выиграли|Ничья/.test(t));
const result = await a.text('.status-main');
console.log('итог:', result?.trim());

console.log('--- партия попала в архив ---');
await sleep(800);
const stored = await a.evaluate(`(() => {
  const index = localStorage.getItem('go_index');
  const sgf = localStorage.getItem('go_sgf_${roomId}');
  return { index, sgf };
})()`);
check('список партий записан', typeof stored.index === 'string' && stored.index.includes(roomId), stored.index?.slice(0, 120) ?? 'пусто');
check('запись партии сохранена', typeof stored.sgf === 'string' && stored.sgf.includes(';B[') && stored.sgf.includes('RE['), stored.sgf?.trim() ?? 'пусто');
check('доигранная часть попала в запись', stored.sgf?.includes('[];W[];') || stored.sgf?.includes('[];B[];'), 'ищем пару пасов посреди записи');
check('в записи девять ходов', (stored.sgf?.match(/;[BW]\[/g) ?? []).length === 9, `${(stored.sgf?.match(/;[BW]\[/g) ?? []).length}`);
check('имена игроков в записи', stored.sgf?.includes('PB[') && stored.sgf?.includes('PW['));

console.log('--- список ---');
await a.clickText('В лобби');
await a.clickText('Мои партии');
await a.waitForText('.status-main', (t) => t.includes('Мои партии'));
const listBody = await a.body();
check('партия видна в списке', listBody.includes(result?.trim() ?? '???'), listBody.split('\n').slice(0, 6).join(' / '));
check('в строке есть размер доски и счёт ходов', listBody.includes('9×9 · 9 ходов'), listBody);
await a.shot('60-archive-list');

console.log('--- просмотр ---');
await a.clickText(result?.trim() ?? '', '*');
await a.waitForText('.status-sub', (t) => t.includes('Ход ') || t.includes('Начальная'));
const atEnd = await a.text('.status-sub');
check('открылись на финальной позиции', /Ход 9 из 9/.test(atEnd ?? ''), atEnd ?? '');
const finalImage = await a.boardImage();

await a.clickText('⏮');
await a.waitForText('.status-sub', (t) => t.includes('Начальная'));
const emptyImage = await a.boardImage();
check('в начале доска пустая и отличается от финальной', emptyImage !== finalImage);

await a.clickText('▶');
check('шаг вперёд — первый ход', (await a.text('.status-sub'))?.includes('Ход 1 из 9'), await a.text('.status-sub'));
const firstImage = await a.boardImage();
check('после первого хода доска изменилась', firstImage !== emptyImage);

await a.clickText('⏭');
check('в конец — та же финальная позиция', (await a.boardImage()) === finalImage);
await a.shot('61-review');

report([a, b]);
