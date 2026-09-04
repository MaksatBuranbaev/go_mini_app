// Принудительная выгрузка комнаты посреди партии (риск §10).
import { HTTP } from './lib/config.mjs';
import { check, report, sleep } from './lib/harness.mjs';
import { Client, createRoom, initDataFor } from './lib/room.mjs';

/** Больше SNAPSHOT_EVERY: восстановление должно идти через снапшот. */
const MOVES = 60;

const blackInit = await initDataFor(501, 'Чёрный');
const whiteInit = await initDataFor(502, 'Белый');

/** Ходы по строкам доски 19×19, чтобы ничего не съедалось и не повторялось. */
function pointAt(n) {
  return { x: n % 19, y: (n / 19) | 0 };
}

const [mode, roomArg] = process.argv.slice(2);

if (mode === 'play') {
  const created = await fetch(`${HTTP}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `tma ${blackInit}` },
    body: JSON.stringify({
      settings: { size: 19, komi: 6.5, handicap: 0, creatorColor: 'black', time: { type: 'none' } },
    }),
  }).then((r) => r.json());

  const black = await Client.connect('чёрный', created.roomId, blackInit);
  black.send({ type: 'join', lastSeq: 0 });
  await black.take('state');
  const white = await Client.connect('белый', created.roomId, whiteInit);
  white.send({ type: 'join', lastSeq: 0 });
  await white.take('state');

  for (let seq = 1; seq <= MOVES; seq++) {
    const who = seq % 2 === 1 ? black : white;
    who.send({ type: 'move', seq, ...pointAt(seq - 1) });
    const echo = await who.take('move');
    if (!echo) throw new Error(`ход ${seq} не принят`);
    black.drain();
    white.drain();
  }

  black.close();
  white.close();
  console.log(`сыграно ходов: ${MOVES}`);
  console.log(`ROOM=${created.roomId}`);
  process.exit(0);
}

if (mode !== 'resume' || !roomArg) {
  console.error('нужно: node hibernate.mjs play | node hibernate.mjs resume <roomId>');
  process.exit(2);
}

// --- второй заход: объект в памяти уже не тот ---

const black = await Client.connect('чёрный', roomArg, blackInit);
black.send({ type: 'join', lastSeq: 0 });
const state = await black.take('state');

check('комната пережила выгрузку', state !== null && state.status === 'playing', state?.status ?? 'ответа нет');
check('все ходы на месте', state?.moves.length === MOVES, `ходов ${state?.moves.length}`);
check('очередь сохранилась', state?.moves.at(-1)?.color === 'white', state?.moves.at(-1)?.color);
check('место осталось за игроком', state?.yourColor === 'black', state?.yourColor ?? 'нет');

// Позиция восстановлена не только в записи: комната должна судить по ней.
black.drain();
black.send({ type: 'move', seq: MOVES + 1, ...pointAt(0) });
const occupied = await black.take('error');
check('позиция восстановлена: занятый пункт отбит', occupied?.code === 'illegal-move', occupied?.code ?? 'ошибки нет');

black.drain();
black.send({ type: 'move', seq: MOVES + 1, ...pointAt(MOVES) });
const accepted = await black.take('move');
check('партия продолжается после выгрузки', accepted?.move.seq === MOVES + 1, `seq ${accepted?.move.seq}`);

// Запись партии тоже собирается из storage, а не из памяти.
const sgf = await fetch(`${HTTP}/rooms/${roomArg}/sgf`, {
  headers: { Authorization: `tma ${blackInit}` },
}).then((r) => r.text());
const recorded = (sgf.match(/;[BW]\[/g) ?? []).length;
check('запись партии полная', recorded === MOVES + 1, `ходов в SGF ${recorded}`);

black.close();
report();
