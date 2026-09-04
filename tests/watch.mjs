// Наблюдатели по ссылке и гонка за второе место.
import { HTTP } from './lib/config.mjs';
import { check, report, sleep } from './lib/harness.mjs';
import { Client, createRoom, initDataFor } from './lib/room.mjs';

const blackInit = await initDataFor(601, 'Чёрный');
const whiteInit = await initDataFor(602, 'Белый');
const watcherInit = await initDataFor(603, 'Зритель');
const watcher2Init = await initDataFor(604, 'Второй зритель');

async function newRoom(initData = blackInit) {
  const created = await fetch(`${HTTP}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `tma ${initData}` },
    body: JSON.stringify({
      settings: { size: 9, komi: 5.5, handicap: 0, creatorColor: 'black', time: { type: 'none' } },
    }),
  }).then((r) => r.json());
  if (created.type !== 'room') throw new Error('комната не создалась: ' + JSON.stringify(created));
  return created.roomId;
}

console.log('--- наблюдатель по ссылке ---');
const roomId = await newRoom();

const black = await Client.connect('чёрный', roomId, blackInit);
black.send({ type: 'join', lastSeq: 0 });
await black.take('state');
const white = await Client.connect('белый', roomId, whiteInit);
white.send({ type: 'join', lastSeq: 0 });
await white.take('state');

black.send({ type: 'move', seq: 1, x: 4, y: 4 });
await black.take('move');
await white.take('move');

let watcher = null;
try {
  watcher = await Client.connect('зритель', roomId, watcherInit);
} catch {
  watcher = null;
}
check('третьего пускают в комнату', watcher !== null);
if (!watcher) {
  console.log('дальше без зрителя не проверить');
  process.exit(1);
}

watcher.send({ type: 'join', lastSeq: 0 });
const watcherState = await watcher.take('state');
check('зритель без места за доской', watcherState?.yourColor === null, String(watcherState?.yourColor));
check('зрителю видна вся партия', watcherState?.moves.length === 1, `ходов ${watcherState?.moves.length}`);
check('превью показывает, что мест нет', await previewColor(roomId, watcherInit) === null);

// Превью проверяет и вход по ссылке: смотреть можно, садиться нельзя.
async function previewColor(id, initData) {
  const preview = await fetch(`${HTTP}/rooms/${id}`, {
    headers: { Authorization: `tma ${initData}` },
  }).then((r) => r.json());
  return preview.yourColor;
}

console.log('--- зритель не вмешивается ---');
watcher.drain();
watcher.send({ type: 'move', seq: 2, x: 0, y: 0 });
const moveDenied = await watcher.take('error');
check('ход зрителя отбит', moveDenied?.code === 'not-seated', moveDenied?.code ?? 'ошибки нет');

watcher.drain();
watcher.send({ type: 'pass', seq: 2 });
check('пас зрителя отбит', (await watcher.take('error'))?.code === 'not-seated');

watcher.drain();
watcher.send({ type: 'resign' });
check('сдача зрителя отбита', (await watcher.take('error'))?.code === 'not-seated');

watcher.drain();
watcher.send({ type: 'scoring:toggle', point: 40 });
check('разметка зрителя отбита', (await watcher.take('error'))?.code === 'not-seated');

// Партия при этом цела: ходит по-прежнему белый.
white.drain();
white.send({ type: 'move', seq: 2, x: 2, y: 2 });
check('партия идёт своим чередом', (await white.take('move'))?.move.seq === 2);

console.log('--- счётчик зрителей ---');
/** Ждёт, пока у клиента станет ровно столько зрителей. */
async function untilWatchers(client, expected, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (client.watchers === expected) return true;
    await sleep(50);
  }
  return false;
}

check('игроки видят зрителя', await untilWatchers(black, 1), `зрителей ${black.watchers}`);
const lastPresence = black.inbox.filter((m) => m.type === 'presence').at(-1);
check('зритель не считается игроком в сети', (lastPresence?.online ?? []).every((c) => c === 'black' || c === 'white'));

const watcher2 = await Client.connect('второй зритель', roomId, watcher2Init);
watcher2.send({ type: 'join', lastSeq: 0 });
await watcher2.take('state');
check('второго зрителя тоже видно', await untilWatchers(black, 2), `зрителей ${black.watchers}`);

watcher2.close();
check('ушедший зритель перестаёт считаться', await untilWatchers(black, 1), `зрителей ${black.watchers}`);

watcher.close();
black.close();
white.close();

console.log('--- оба открыли ссылку одновременно ---');
const raceRoom = await newRoom();
const host = await Client.connect('хозяин', raceRoom, blackInit);
host.send({ type: 'join', lastSeq: 0 });
await host.take('state');

// Двое ломятся на единственное свободное место в один момент.
const [first, second] = await Promise.all([
  Client.connect('первый', raceRoom, whiteInit),
  Client.connect('второй', raceRoom, watcherInit),
]);
first.send({ type: 'join', lastSeq: 0 });
second.send({ type: 'join', lastSeq: 0 });
const firstState = await first.take('state');
const secondState = await second.take('state');

const colors = [firstState?.yourColor, secondState?.yourColor];
check('никого не выкинули', firstState !== null && secondState !== null);
check('место досталось ровно одному', colors.filter((c) => c === 'white').length === 1, JSON.stringify(colors));
check('второй остался зрителем', colors.filter((c) => c === null).length === 1, JSON.stringify(colors));
check('партия началась', firstState?.status === 'playing' || secondState?.status === 'playing');

host.close();
first.close();
second.close();

report();
