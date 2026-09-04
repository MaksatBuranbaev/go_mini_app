// Синхронизация двух игроков и часы во время отправки хода.
import { check, report, sleep } from './lib/harness.mjs';
import { Tab } from './lib/tab.mjs';

const seconds = (t) => [...(t ?? '').matchAll(/(\d+):(\d\d)/g)].map(([, m, s]) => Number(m) * 60 + Number(s));

const a = await Tab.open('A', 'http://localhost:5173/?dev_user=31');
await sleep(2800);
await a.clickText('Чёрные');
await a.clickStartsWith('~ 5 мин');
await a.clickText('Пригласить друга');
const link = await a.waitForText('.invite-link', (t) => t.includes('startapp='));
const roomId = decodeURIComponent(link.split('startapp=')[1]);
console.log('комната:', roomId);

const b = await Tab.open('B', `http://localhost:5173/?dev_user=32&startapp=${encodeURIComponent(roomId)}`);
await sleep(2800);
await b.clickText('Принять');
await a.waitForText('.status-main', (t) => t.includes('Ваш ход'));

console.log('--- кнопка подтверждения ---');
check('кнопки «Подтвердить ход» на экране нет', !(await a.buttons()).includes('Подтвердить ход'), (await a.buttons()).join(', '));

console.log('--- ход в два тапа ---');
await a.tap(2, 2, 1);
check('первый тап только целится', (await a.text('.status-sub'))?.includes('Тапните ещё раз'), await a.text('.status-sub'));
await a.tap(2, 2, 1);
await b.waitForText('.status-main', (t) => t.includes('Ваш ход'));
check('второй тап по той же точке ставит камень', true);

console.log('--- доски совпадают ---');
// Захват в углу: съеденный камень обязан исчезнуть у обоих.
const moves = [
  [b, 8, 0],
  [a, 7, 0],
  [b, 4, 4],
  [a, 8, 1],
];
for (const [who, x, y] of moves) {
  await who.waitForText('.status-main', (t) => t.includes('Ваш ход'));
  await who.tap(x, y);
  await sleep(500);
}
await sleep(800);
const imageA = await a.boardImage();
const imageB = await b.boardImage();
check('доски у игроков попиксельно одинаковы', imageA !== null && imageA === imageB,
  imageA === imageB ? '' : `${imageA?.length} против ${imageB?.length} символов`);

console.log('--- ход, который не доехал ---');
await b.waitForText('.status-main', (t) => t.includes('Ваш ход'));
// Ходит B, и как раз у него рвётся связь на отправке.
await b.offline(true);
await b.tap(0, 8);
await sleep(300);
const clockStart = seconds(await b.text('.clocks'));
const whiteStart = clockStart[1];
await sleep(4000);
const clockLater = seconds(await b.text('.clocks'));
check('свои часы идут, пока ход не подтверждён', clockLater[1] <= whiteStart - 3,
  `${whiteStart} -> ${clockLater[1]}`);
check('часы соперника при этом стоят', clockLater[0] === clockStart[0],
  `${clockStart[0]} -> ${clockLater[0]}`);
const warn = await b.text('.status-warn');
check('игрок предупреждён, что ход не доходит', warn?.includes('не доходит') === true, warn ?? 'подписи нет');
await b.shot('50-move-in-flight');

const strandedB = await b.boardImage();
const stillA = await a.boardImage();
check('недоехавший ход виден только у себя', strandedB !== stillA);

console.log('--- связь вернулась ---');
await b.offline(false);
await b.waitForText('.status-sub', (t) => !t.includes('Связь потеряна'), 60);
await sleep(2500);
const healedB = await b.boardImage();
const healedA = await a.boardImage();
check('после реконнекта доски снова одинаковы', healedB === healedA);

// Доехал ли буферизованный кадр до комнаты — как повезёт, и оба исхода
// законны. Важно, что очередь у игроков не разъехалась: ход ровно у одного.
const mainA = await a.text('.status-main');
const mainB = await b.text('.status-main');
check('ход ровно у одного игрока', mainA?.includes('Ваш ход') !== mainB?.includes('Ваш ход'),
  `A: ${mainA?.trim()} | B: ${mainB?.trim()}`);

const clockB = seconds(await b.text('.clocks'));
const clockA = seconds(await a.text('.clocks'));
check('часы после реконнекта сошлись', Math.abs(clockB[1] - clockA[1]) <= 2, `${clockB[1]} против ${clockA[1]}`);
await b.shot('51-after-reconnect');

// И партия продолжается: ходит тот, чья очередь.
const mover = mainA?.includes('Ваш ход') ? a : b;
const other = mover === a ? b : a;
await mover.tap(5, 6);
await other.waitForText('.status-main', (t) => t.includes('Ваш ход'), 60);
check('после реконнекта ход проходит', true);
await sleep(600);
const finalMover = await mover.boardImage();
const finalOther = await other.boardImage();
check('доски совпали и после следующего хода', finalMover === finalOther);

report([a, b]);
