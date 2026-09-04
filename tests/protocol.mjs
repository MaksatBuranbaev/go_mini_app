// Крайние случаи протокола комнаты, которые через UI не воспроизвести:
import { HTTP } from './lib/config.mjs';
import { check, report, sleep } from './lib/harness.mjs';
import { Client, createRoom, initDataFor } from './lib/room.mjs';

const blackInit = await initDataFor(101, 'Чёрный');
const whiteInit = await initDataFor(102, 'Белый');
const thirdInit = await initDataFor(103, 'Третий');

console.log('--- авторизация ---');

const forged = await initDataFor(101, 'Чёрный', '9999:НЕ_ТОТ_ТОКЕН');
const forgedResponse = await fetch(`${HTTP}/rooms`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `tma ${forged}` },
  body: JSON.stringify({
    settings: { size: 9, komi: 5.5, handicap: 0, creatorColor: 'black', time: { type: 'none' } },
  }),
});
check('подпись чужим токеном отвергается', forgedResponse.status === 401, `статус ${forgedResponse.status}`);

const created = await fetch(`${HTTP}/rooms`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `tma ${blackInit}` },
  body: JSON.stringify({
    settings: { size: 9, komi: 5.5, handicap: 0, creatorColor: 'black', time: { type: 'none' } },
  }),
}).then((r) => r.json());
check('комната создана', created.type === 'room' && created.yourColor === 'black', JSON.stringify(created).slice(0, 90));

const roomId = created.roomId;

console.log('--- посадка за доску ---');

const black = await Client.connect('чёрный', roomId, blackInit);
black.send({ type: 'join', lastSeq: 0 });
const blackState = await black.take('state');
check('чёрный получил снапшот', blackState?.yourColor === 'black' && blackState.status === 'waiting');

const white = await Client.connect('белый', roomId, whiteInit);
white.send({ type: 'join', lastSeq: 0 });
const whiteState = await white.take('state');
check('белый сел на второе место', whiteState?.yourColor === 'white');
check('партия началась после второго игрока', whiteState?.status === 'playing', `статус ${whiteState?.status}`);

let third = null;
try {
  third = await Client.connect('третий', roomId, thirdInit);
} catch {
  third = null;
}
check('третий подключается', third !== null);
third?.send({ type: 'join', lastSeq: 0 });
const thirdState = await third?.take('state');
check('третьего за доску не сажают', thirdState?.yourColor === null, String(thirdState?.yourColor));
third?.close();

console.log('--- ходы ---');

black.send({ type: 'move', seq: 1, x: 4, y: 4 });
const firstMove = await black.take('move');
check('ход чёрных принят', firstMove?.move.seq === 1 && firstMove.move.color === 'black');
check('ход доехал до белых', (await white.take('move'))?.move.seq === 1);

// Двойной тап: тот же seq повторно. Ход дублироваться не должен.
black.send({ type: 'move', seq: 1, x: 0, y: 0 });
const resync = await black.take('state');
check('повтор seq возвращает состояние, а не второй ход', resync !== null);
check('дубль не попал в список ходов', resync?.moves.length === 1, `ходов ${resync?.moves.length}`);

// Нечестный клиент: ход не в свою очередь.
black.send({ type: 'move', seq: 2, x: 1, y: 1 });
const notYourTurn = await black.take('error');
check('чужой ход отбит', notYourTurn?.code === 'not-your-turn', notYourTurn?.code);

// Нечестный клиент: ход на занятый пункт. Клиент такое не пришлёт, комната обязана поймать.
white.send({ type: 'move', seq: 2, x: 4, y: 4 });
const illegal = await white.take('error');
check('ход на занятый пункт отбит комнатой', illegal?.code === 'illegal-move', illegal?.code);

white.send({ type: 'move', seq: 2, x: 3, y: 3 });
check('легальный ход белых принят', (await white.take('move'))?.move.seq === 2);
await black.take('move');

console.log('--- реконнект ---');

black.close();
await sleep(400);
const backAgain = await Client.connect('чёрный снова', roomId, blackInit);
backAgain.send({ type: 'join', lastSeq: 1 });
const sync = await backAgain.take('sync');
check('вернувшийся получил дельту, а не снапшот', sync !== null);
check('в дельте только пропущенное', sync?.moves.length === 1 && sync.moves[0].seq === 2, JSON.stringify(sync?.moves.map((m) => m.seq)));
check('место осталось за ним', sync?.yourColor === 'black');

const presence = await white.take('presence');
check('соперник увидел возвращение', presence !== null && presence.online.includes('black'));

console.log('--- мусорные сообщения ---');
backAgain.socket.send('это не json');
check('битый кадр не роняет комнату', (await backAgain.take('error'))?.code === 'bad-message');
backAgain.send({ type: 'move', seq: 'три', x: 1, y: 1 });
check('сообщение не по схеме отбито', (await backAgain.take('error'))?.code === 'bad-message');

backAgain.send({ type: 'join', lastSeq: 0 });
const finalState = await backAgain.take('state');
check('комната жива после мусора', finalState?.moves.length === 2, `ходов ${finalState?.moves.length}`);

backAgain.close();
white.close();
report();
