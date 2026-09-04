// Синхронизация двух игроков и часы во время отправки хода.
import { check, report, sleep } from './lib/harness.mjs';
import { Tab } from './lib/tab.mjs';

const a = await Tab.open('A', 'http://localhost:5173/?dev_user=71');
await sleep(2800);
await a.clickText('Чёрные');
await a.clickText('Пригласить друга');
const link = await a.waitForText('.invite-link', (t) => t.includes('startapp='));
const roomId = decodeURIComponent(link.split('startapp=')[1]);
console.log('комната:', roomId);

const b = await Tab.open('B', `http://localhost:5173/?dev_user=72&startapp=${encodeURIComponent(roomId)}`);
await sleep(2800);
await b.clickText('Принять');
await a.waitForText('.status-main', (t) => t.includes('Ваш ход'));
await a.tap(2, 2);
await b.waitForText('.status-main', (t) => t.includes('Ваш ход'));

console.log('--- третий приходит по ссылке ---');
const c = await Tab.open('C', `http://localhost:5173/?dev_user=73&startapp=${encodeURIComponent(roomId)}`);
await sleep(2800);
const invite = await c.evaluate('document.body.innerText');
check('приглашение честно говорит, что мест нет', invite.includes('можно смотреть'), invite.split('\n').slice(0, 3).join(' / '));
check('предлагается смотреть', invite.includes('Смотреть партию'));
await c.shot('70-invite-full');

await c.clickText('Смотреть партию');
await c.waitForText('.status-main', (t) => t.includes('Ход '));
const watcherMain = await c.text('.status-main');
const watcherSub = await c.text('.status-sub');
check('зритель видит, чей ход', /Ход (чёрных|белых)/.test(watcherMain ?? ''), watcherMain ?? '');
check('зрителю сказано, что он наблюдает', watcherSub?.includes('наблюдаете'), watcherSub ?? '');

const watcherButtons = await c.buttons();
check('зрителю не дают ходить', !watcherButtons.includes('Пас') && !watcherButtons.includes('Сдаться'), watcherButtons.join(', '));
check('у зрителя есть выход', watcherButtons.includes('В лобби'), watcherButtons.join(', '));
await c.shot('71-watching');

console.log('--- игроки видят зрителя ---');
await sleep(600);
const playerSub = await a.text('.status-sub');
check('в подписи у игрока есть зритель', playerSub?.includes('смотрит'), playerSub ?? '');

console.log('--- ходы доезжают до зрителя ---');
// Попиксельно доски игрока и зрителя не сравнить: у зрителя нет ряда кнопок,
// и доска получает другую высоту. Сравниваем каждую с самой собой.
const watcherBefore = await c.boardImage();
const playerBefore = await a.boardImage();
await b.waitForText('.status-main', (t) => t.includes('Ваш ход'));
await b.tap(6, 6);
await sleep(900);
check('ход игрока виден зрителю', (await c.boardImage()) !== watcherBefore);
check('ход виден и сопернику', (await a.boardImage()) !== playerBefore);

console.log('--- тап зрителя ничего не делает ---');
const beforeTap = await c.boardImage();
const beforeTapPlayer = await a.boardImage();
await c.tap(4, 4);
await sleep(700);
check('камень от тапа зрителя не появился', (await c.boardImage()) === beforeTap);
check('у игроков доска не изменилась', (await a.boardImage()) === beforeTapPlayer);

console.log('--- разрыв связи ---');
await a.offline(true);
await sleep(2000);
const banner = await a.text('.banner');
check('полоса о разрыве показана', banner?.includes('Связь потеряна'), banner ?? 'полосы нет');
check('в полосе есть кнопка', (await a.buttons()).includes('Повторить'), (await a.buttons()).join(', '));
await a.shot('72-offline-banner');

await a.offline(false);
for (let i = 0; i < 40 && (await a.text('.banner')) !== null; i++) await sleep(300);
check('после возврата связи полоса уходит', (await a.text('.banner')) === null, await a.text('.banner'));
check('партия на месте', (await a.text('.status-main'))?.includes('ход'), await a.text('.status-main'));

console.log('--- вход в комнату без связи ---');
// Приложение уже загружено, а сети нет: комната недостижима с первого кадра.
const d = await Tab.open('D', `http://localhost:5173/?dev_user=74&startapp=${encodeURIComponent(roomId)}`);
await sleep(2800);
await d.offline(true);
await d.clickText('Смотреть партию');
await sleep(2500);
const offlineBody = await d.evaluate('document.body.innerText');
check('без связи показан честный экран', offlineBody.includes('Нет связи'), offlineBody.split('\n').slice(0, 4).join(' / '));
check('с экрана есть выход', (await d.buttons()).includes('В лобби'), (await d.buttons()).join(', '));
await d.shot('73-offline-screen');

console.log('--- лобби без связи ---');
const e = await Tab.open('E', 'http://localhost:5173/?dev_user=75');
await sleep(2800);
await e.offline(true);
await e.clickText('Пригласить друга');
await sleep(2500);
const lobbyBody = await e.evaluate('document.body.innerText');
check('лобби объясняет, почему не вышло', lobbyBody.includes('Не вышло'), lobbyBody.split('\n').slice(-5).join(' / '));
await e.shot('74-lobby-offline');

report([a, b, c, d, e]);
