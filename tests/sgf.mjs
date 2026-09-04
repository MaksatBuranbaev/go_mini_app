// Выгрузка записи партии из комнаты и попытка уведомления «ваш ход».
import { HTTP } from './lib/config.mjs';
import { check, report, sleep } from './lib/harness.mjs';
import { Client, createRoom, initDataFor } from './lib/room.mjs';

const blackInit = await initDataFor(301, 'Чёрный');
const whiteInit = await initDataFor(302, 'Белый');

const created = await fetch(`${HTTP}/rooms`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `tma ${blackInit}` },
  body: JSON.stringify({
    settings: { size: 9, komi: 5.5, handicap: 2, creatorColor: 'black', time: { type: 'none' } },
  }),
}).then((r) => r.json());
const roomId = created.roomId;
console.log('комната:', roomId);

const black = await Client.connect('чёрный', roomId, blackInit);
black.send({ type: 'join', lastSeq: 0 });
await black.take('state');
const white = await Client.connect('белый', roomId, whiteInit);
white.send({ type: 'join', lastSeq: 0 });
await white.take('state');

// Фора 2 — первый ход за белыми. Хоси (2,6) и (6,2) уже заняты форовыми
// камнями, поэтому ходим мимо них.
const moves = [
  [white, 4, 4],
  [black, 1, 1],
  [white, 7, 7],
];
let seq = 0;
for (const [who, x, y] of moves) {
  who.send({ type: 'move', seq: ++seq, x, y });
  await black.take('move');
  await white.take('move');
}
black.send({ type: 'pass', seq: ++seq });
await white.take('move');

console.log('--- выгрузка записи ---');
const sgfResponse = await fetch(`${HTTP}/rooms/${roomId}/sgf`, {
  headers: { Authorization: `tma ${blackInit}` },
});
check('комната отдаёт запись', sgfResponse.status === 200, `статус ${sgfResponse.status}`);
const sgf = await sgfResponse.text();
console.log(sgf.trim());

check('размер доски в записи', sgf.includes('SZ[9]'));
check('коми в записи', sgf.includes('KM[5.5]'));
check('фора и расстановка камней', sgf.includes('HA[2]') && sgf.includes('AB['));
check('имена игроков', sgf.includes('PB[Чёрный]') && sgf.includes('PW[Белый]'));
check('ходы записаны в порядке партии', sgf.includes(';W[ee];B[bb];W[hh];B[]'), 'ищем ;W[ee];B[bb];W[hh];B[]');

const anonymous = await fetch(`${HTTP}/rooms/${roomId}/sgf`);
check('без подписи запись не отдаётся', anonymous.status === 401, `статус ${anonymous.status}`);

const missing = await fetch(`${HTTP}/rooms/AAAAAAAAAAAA/sgf`, {
  headers: { Authorization: `tma ${blackInit}` },
});
check('несуществующая комната — 404', missing.status === 404, `статус ${missing.status}`);

console.log('--- уведомление «ваш ход» ---');
// После паса чёрных ходят белые — отвечаем, чтобы очередь вернулась к чёрным.
white.drain();
white.send({ type: 'move', seq: ++seq, x: 0, y: 0 });
await white.take('move');

// Теперь белый уходит, а чёрный ходит: очередь переходит к тому, кого нет
// за доской, и комната обязана попытаться написать ему боту.
white.close();
await sleep(500);
black.drain();
black.send({ type: 'move', seq: ++seq, x: 0, y: 8 });
const echo = await black.take('move');
check('ход при отключённом сопернике проходит', echo?.move.seq === seq, `seq ${echo?.move.seq}`);
console.log('(попытку отправки ищем в логе wrangler: с тестовым токеном Telegram ответит 404)');

black.close();
report();
