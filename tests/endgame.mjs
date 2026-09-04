// Завершение партии: два паса, разметка мёртвых, подсчёт, «доиграть»,
import { HTTP } from './lib/config.mjs';
import { check, report, sleep } from './lib/harness.mjs';
import { Client, createRoom, initDataFor } from './lib/room.mjs';

const NO_CLOCK = { type: 'none' };

const blackInit = await initDataFor(201, 'Чёрный');
const whiteInit = await initDataFor(202, 'Белый');

/** Заводит комнату и сажает обоих игроков. */
async function newRoom(time = NO_CLOCK, size = 9) {
  const created = await fetch(`${HTTP}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `tma ${blackInit}` },
    body: JSON.stringify({
      settings: { size, komi: 5.5, handicap: 0, creatorColor: 'black', time },
    }),
  }).then((r) => r.json());
  if (created.type !== 'room') throw new Error('комната не создалась: ' + JSON.stringify(created));

  const black = await Client.connect('чёрный', created.roomId, blackInit);
  black.send({ type: 'join', lastSeq: 0 });
  await black.take('state');
  const white = await Client.connect('белый', created.roomId, whiteInit);
  white.send({ type: 'join', lastSeq: 0 });
  await white.take('state');
  return { roomId: created.roomId, black, white };
}

console.log('--- два паса и подсчёт ---');
{
  const { black, white } = await newRoom();

  // Чёрные занимают левый край, белые правый: у каждого будет территория.
  const opening = [
    [black, 1, 1],
    [white, 7, 1],
    [black, 1, 4],
    [white, 7, 4],
    [black, 1, 7],
    [white, 7, 7],
  ];
  let seq = 0;
  for (const [who, x, y] of opening) {
    who.send({ type: 'move', seq: ++seq, x, y });
    await black.take('move');
    await white.take('move');
  }

  black.send({ type: 'pass', seq: ++seq });
  const passEcho = await black.take('move');
  check('пас записан как ход', passEcho?.move.type === 'pass', passEcho?.move.type);

  white.send({ type: 'pass', seq: ++seq });
  const scoring = await white.take('scoring');
  check('два паса переводят в подсчёт', scoring?.status === 'scoring');
  check('соперник тоже получил подсчёт', (await black.take('scoring')) !== null);
  check('согласия пока нет', scoring?.scoring.acceptedBy.length === 0);

  // Отметить мёртвым живой камень чёрных: разметка расходится по обоим.
  const point = 1 * 9 + 1;
  white.send({ type: 'scoring:toggle', point });
  const toggled = await black.take('scoring');
  check('разметка доехала до соперника', toggled?.scoring.dead.includes(point));

  white.send({ type: 'scoring:accept' });
  const oneAccepted = await black.take('scoring');
  check('одно согласие партию не закрывает', oneAccepted?.scoring.acceptedBy.length === 1);

  // Правка после согласия его снимает.
  black.send({ type: 'scoring:toggle', point });
  const afterEdit = await black.take('scoring');
  check('правка снимает согласие', afterEdit?.scoring.acceptedBy.length === 0);
  check('камень снова живой', !afterEdit?.scoring.dead.includes(point));

  black.send({ type: 'scoring:accept' });
  await white.take('scoring');
  white.send({ type: 'scoring:accept' });
  const over = await black.take('over');
  check('два согласия закрывают партию', over !== null, JSON.stringify(over?.result));
  check('в итоге есть счёт обеих сторон', typeof over?.score?.black === 'number');
  // 3 камня + территория против 3 камней + территория + коми 5.5.
  check('счёт сошёлся с китайским подсчётом', over?.result === 'W+5.5', over?.result);

  black.close();
  white.close();
}

console.log('--- доиграть ---');
{
  const { black, white } = await newRoom();
  black.send({ type: 'pass', seq: 1 });
  await white.take('move');
  white.send({ type: 'pass', seq: 2 });
  await black.take('scoring');

  black.drain();
  white.drain();
  black.send({ type: 'scoring:resume' });
  const back = await black.take('state');
  check('«доиграть» возвращает партию в игру', back?.status === 'playing', back?.status);

  // После возврата ходы снова принимаются, хотя два паса остались в записи.
  black.drain();
  white.drain();
  black.send({ type: 'move', seq: 3, x: 4, y: 4 });
  const move = await black.take('move');
  check('ход после возврата принят', move?.move.seq === 3, JSON.stringify(move?.move.type));

  // И два новых паса снова уводят в подсчёт.
  white.drain();
  white.send({ type: 'pass', seq: 4 });
  await white.take('move');
  black.drain();
  black.send({ type: 'pass', seq: 5 });
  check('пара новых пасов снова даёт подсчёт', (await black.take('scoring')) !== null);

  // Второе «доиграть» заставляет комнату переиграть запись целиком, а в ней
  // теперь есть ход после двух пасов. Раньше на этом прогон падал.
  black.drain();
  white.drain();
  black.send({ type: 'scoring:resume' });
  const again = await black.take('state');
  check('запись с продолжением после пасов воспроизводится', again?.status === 'playing', again?.status);
  check('в записи все ходы на месте', again?.moves.length === 5, `ходов ${again?.moves.length}`);

  black.drain();
  white.send({ type: 'move', seq: 6, x: 6, y: 6 });
  const afterSecond = await white.take('move');
  check('ход после второго возврата принят', afterSecond?.move.seq === 6, JSON.stringify(afterSecond?.move));

  black.close();
  white.close();
}

console.log('--- сдача ---');
{
  const { black, white } = await newRoom();
  black.send({ type: 'move', seq: 1, x: 2, y: 2 });
  await black.take('move');
  await white.take('move');

  // Белые сдаются, хотя сейчас как раз их ход.
  white.send({ type: 'resign' });
  const over = await black.take('over');
  check('сдача закрывает партию', over?.result === 'B+R', over?.result);

  black.send({ type: 'move', seq: 2, x: 3, y: 3 });
  const err = await black.take('error');
  check('после сдачи ходить нельзя', err?.code === 'not-playing', err?.code);

  black.close();
  white.close();
}

console.log('--- просрочка по будильнику ---');
{
  // Двух секунд на всю партию хватит, чтобы дождаться будильника в тесте.
  const { black, white } = await newRoom({ type: 'fischer', mainMs: 2000, incrementMs: 0 });

  const state = await black.take('state', 500);
  check('часы поехали, как только сели оба', state === null || state.clock !== undefined);

  // Никто не ходит: время чёрных должно кончиться само.
  const over = await white.take('over', 8000);
  check('просрочка закрывает партию без единого хода', over?.result === 'W+T', over?.result);

  black.close();
  white.close();
}

console.log('--- часы идут по ходам ---');
{
  const { black, white } = await newRoom({ type: 'fischer', mainMs: 60_000, incrementMs: 5_000 });
  await sleep(1200);

  black.send({ type: 'move', seq: 1, x: 2, y: 2 });
  const move = await black.take('move');
  const clock = move?.clock;
  check('в ходе приехали часы', clock !== undefined);
  // Секунду думали, пять получили обратно: больше стартовых 60, но не 65 ровно.
  check(
    'Фишер списал раздумье и добавил инкремент',
    clock && clock.blackMs > 63_000 && clock.blackMs < 65_000,
    `${clock?.blackMs} мс`,
  );
  check('у соперника время не тронуто', clock?.whiteMs === 60_000, `${clock?.whiteMs} мс`);
  check('часы переданы сопернику', clock?.lastMoveAt !== null);

  black.close();
  white.close();
}

report();
