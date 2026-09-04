// Отмена хода: просьба, ответ соперника и сам откат — по протоколу и в экране.
import { check, report, sleep } from './lib/harness.mjs';
import { Client, createRoom, initDataFor } from './lib/room.mjs';
import { Tab } from './lib/tab.mjs';

const FISCHER = { type: 'fischer', mainMs: 60_000, incrementMs: 5_000 };

const blackInit = await initDataFor(701, 'Чёрный');
const whiteInit = await initDataFor(702, 'Белый');
const watcherInit = await initDataFor(703, 'Зритель');

const roomId = await createRoom(blackInit, { time: FISCHER });
const black = await Client.connect('чёрный', roomId, blackInit);
black.send({ type: 'join', lastSeq: 0 });
await black.take('state');
const white = await Client.connect('белый', roomId, whiteInit);
white.send({ type: 'join', lastSeq: 0 });
const started = await white.take('state');
check('партия началась', started?.status === 'playing', started?.status ?? 'нет state');

console.log('--- просить можно только о своём последнем ходе ---');
black.send({ type: 'undo:request' });
let refused = await black.take('error');
check('до первого хода отменять нечего', refused?.code === 'nothing-to-undo', refused?.code ?? 'без ошибки');

black.send({ type: 'move', seq: 1, x: 4, y: 4 });
await black.take('move');
await white.take('move');

white.send({ type: 'undo:request' });
refused = await white.take('error');
check('чужой ход отменить нельзя', refused?.code === 'nothing-to-undo', refused?.code ?? 'без ошибки');

console.log('--- отказ ---');
black.send({ type: 'undo:request' });
const asked = await white.take('undo');
check('соперник видит просьбу', asked?.undo?.by === 'black' && asked.undo.seq === 1, JSON.stringify(asked?.undo));
check('просьба видна и просившему', (await black.take('undo'))?.undo?.by === 'black');

white.send({ type: 'undo:answer', accept: false });
const declined = await black.take('undo');
check('отказ снимает просьбу', declined?.undo === null && declined.declined === true, JSON.stringify(declined));

// Ход на месте: отказ ничего не откатывает.
black.drain();
black.send({ type: 'join', lastSeq: 0 });
let state = await black.take('state');
check('после отказа ход остался', state?.moves.length === 1, `ходов ${state?.moves.length}`);
const afterMoveMs = state.clock.blackMs;

console.log('--- согласие ---');
white.drain();
black.send({ type: 'undo:request' });
await white.take('undo');
white.send({ type: 'undo:answer', accept: true });

state = await black.take('state');
const whiteState = await white.take('state');
check('ход снят у обоих', state?.moves.length === 0 && whiteState?.moves.length === 0, `${state?.moves.length}/${whiteState?.moves.length}`);
check('просьба снята вместе с ходом', state?.undo === null, JSON.stringify(state?.undo));
check(
  'добавка Фишера снята вместе с ходом',
  state.clock.blackMs < afterMoveMs && state.clock.blackMs <= 60_000,
  `${afterMoveMs} -> ${state.clock.blackMs} мс`,
);

// Ход снова за чёрными — тем же номером.
black.send({ type: 'move', seq: 1, x: 2, y: 2 });
const replayed = await white.take('move');
check('после отката ходит снова тот же игрок', replayed?.move.color === 'black' && replayed.move.x === 2, JSON.stringify(replayed?.move));

console.log('--- просьба протухает ---');
black.drain();
white.drain();
black.send({ type: 'undo:request' });
await Promise.all([white.take('undo'), black.take('undo')]);
// Соперник не ответил, а походил: отменять уже нечего.
white.send({ type: 'move', seq: 2, x: 6, y: 6 });
await black.take('move');
const cleared = await black.take('undo');
check('ход соперника снимает просьбу', cleared?.undo === null && cleared.declined === false, JSON.stringify(cleared));

console.log('--- просьба переживает реконнект ---');
white.send({ type: 'undo:request' });
await Promise.all([white.take('undo'), black.take('undo')]);
black.send({ type: 'join', lastSeq: 1 });
const sync = await black.take('sync');
check('дельта несёт висящую просьбу', sync?.undo?.by === 'white', JSON.stringify(sync?.undo));
white.send({ type: 'undo:cancel' });
const withdrawn = await black.take('undo');
check('просивший может передумать', withdrawn?.undo === null, JSON.stringify(withdrawn));

console.log('--- наблюдатель ---');
const watcher = await Client.connect('зритель', roomId, watcherInit);
watcher.send({ type: 'join', lastSeq: 0 });
await watcher.take('state');
watcher.send({ type: 'undo:request' });
check('зритель не просит за игроков', (await watcher.take('error'))?.code === 'not-seated');

black.close();
white.close();
watcher.close();

console.log('--- экран: просьба и согласие ---');
const a = await Tab.open('A', '/?dev_user=71');
await sleep(2800);
await a.clickText('Чёрные');
await a.clickText('Пригласить друга');
const link = await a.waitForText('.invite-link', (t) => t.includes('startapp='));
const uiRoom = decodeURIComponent(link.split('startapp=')[1]);
const b = await Tab.open('B', `http://localhost:5173/?dev_user=72&startapp=${encodeURIComponent(uiRoom)}`);
await sleep(2800);
await b.clickText('Принять');
await a.waitForText('.status-main', (t) => t.includes('Ваш ход'));

const empty = await a.boardImage();
await a.tap(4, 4);
await b.waitForText('.status-main', (t) => t.includes('Ваш ход'));
await sleep(400);
check('камень встал', (await a.boardImage()) !== empty);

await a.send('Page.bringToFront');
await sleep(200);
check('после своего хода предлагают отменить', (await a.buttons()).includes('Отменить ход'));
await a.clickText('Отменить ход');
await sleep(500);
check('просившему видно, что ждём ответа', (await a.body()).includes('Ждём ответа соперника'));

await b.send('Page.bringToFront');
await b.waitForText('.request', (t) => t.includes('просит отменить'));
check('сопернику видно просьбу', true);
await b.clickText('Разрешить');
await sleep(700);

await a.send('Page.bringToFront');
await a.waitForText('.status-main', (t) => t.includes('Ваш ход'));
await sleep(500);
check('камень снялся у просившего', (await a.boardImage()) === empty);
check('и ход вернулся к нему', (await a.body()).includes('Ваш ход'));
await b.send('Page.bringToFront');
await sleep(500);
check('доски сошлись после отката', (await b.boardImage()) === (await a.boardImage()));
await a.shot('90-undo');

console.log('--- на одном устройстве ---');
const c = await Tab.open('C', '/?dev_user=73');
await sleep(2800);
await c.clickText('На одном устройстве');
await sleep(600);
const cleanBoard = await c.boardImage();
await c.tap(3, 3);
await sleep(400);
check('ход поставлен', (await c.boardImage()) !== cleanBoard);
await c.clickText('Отменить ход');
await sleep(500);
check('за одним устройством отменяется сразу', (await c.boardImage()) === cleanBoard, '');
check('и ход снова первый', (await c.body()).includes('Ход чёрных'));

report([a, b, c]);
