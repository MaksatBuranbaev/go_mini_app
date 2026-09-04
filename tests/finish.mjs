// Завершение партии глазами игроков: два паса, экран подсчёта, разметка
import { check, report, sleep } from './lib/harness.mjs';
import { Tab } from './lib/tab.mjs';

const a = await Tab.open('A', 'http://localhost:5173/?dev_user=11');
await sleep(2800);

await a.clickText('Чёрные');
await a.clickStartsWith('~ 10 мин');
await a.clickText('Пригласить друга');

const link = await a.waitForText('.invite-link', (t) => t.includes('startapp='));
const roomId = decodeURIComponent(link.split('startapp=')[1]);
console.log('комната:', roomId);

const b = await Tab.open('B', `http://localhost:5173/?dev_user=12&startapp=${encodeURIComponent(roomId)}`);
await sleep(2800);
check('приглашение показывает контроль времени', (await b.body()).includes('2 мин + 7 сек'));
await b.clickText('Принять');
await sleep(1200);

await a.waitForText('.status-main', (t) => t.includes('Ваш ход'));
check('часы появились в шапке', (await a.text('.clocks')) !== null, await a.text('.clocks'));
await a.shot('30-clock');

// Пара ходов, чтобы на доске было что размечать.
const moves = [
  [a, 1, 1],
  [b, 7, 7],
  [a, 1, 7],
  [b, 7, 1],
];
for (const [tab, x, y] of moves) {
  await tab.waitForText('.status-main', (t) => t.includes('Ваш ход'));
  await tab.tap(x, y);
  await sleep(400);
}

const clockAfter = await a.text('.clocks');
console.log('часы после ходов:', clockAfter?.trim());

// Два паса подряд.
await a.waitForText('.status-main', (t) => t.includes('Ваш ход'));
await a.clickText('Пас');
await sleep(600);
await b.waitForText('.status-main', (t) => t.includes('Ваш ход'));
await b.clickText('Пас');
await sleep(900);

check('A ушёл в подсчёт', (await a.text('.status-main'))?.includes('мёртвые'), await a.text('.status-main'));
check('B ушёл в подсчёт', (await b.text('.status-main'))?.includes('мёртвые'), await b.text('.status-main'));
await a.shot('31-scoring-a');
await b.shot('32-scoring-b');

// Один игрок помечает группу соперника мёртвой — отметка должна доехать.
await a.tap(7, 7, 1);
await sleep(700);
const bAfterMark = await b.evaluate(`document.querySelector('canvas') ? true : false`);
check('доска у соперника на месте после разметки', bAfterMark === true);
await b.shot('33-marked-b');

await a.clickText('Принять счёт');
await sleep(600);
check('после одного согласия ждём второго', (await a.text('.status-sub'))?.includes('Ждём'), await a.text('.status-sub'));

await b.clickText('Принять счёт');
await sleep(900);

const resultA = await a.text('.status-main');
const resultB = await b.text('.status-main');
console.log('итог у A:', resultA?.trim());
console.log('итог у B:', resultB?.trim());
check('партия закрыта у обоих', /выиграли|Ничья/.test(resultA ?? '') && /выиграли|Ничья/.test(resultB ?? ''));
check('итоговый счёт показан', (await a.text('.status-sub'))?.includes(':'), await a.text('.status-sub'));
await a.shot('34-finished-a');
await b.shot('35-finished-b');

report([a, b]);
