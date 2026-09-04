// Системы подсчёта: одна и та же партия, посчитанная по-китайски и по-японски.
import { HTTP } from './lib/config.mjs';
import { check, report } from './lib/harness.mjs';
import { Client, createRoom, initDataFor } from './lib/room.mjs';

const blackInit = await initDataFor(701, 'Чёрный');
const whiteInit = await initDataFor(702, 'Белый');

/**
 * Партия, где системы обязаны разойтись: чёрные берут пленного и остаются
 * одни на доске. Территория 79 пунктов у обеих, дальше расхождение —
 * китайская добавляет два своих камня, японская одного пленного.
 */
async function playSample(rules) {
  const roomId = await createRoom(blackInit, { rules, komi: 0.5 });

  const black = await Client.connect('чёрный', roomId, blackInit);
  black.send({ type: 'join', lastSeq: 0 });
  await black.take('state');
  const white = await Client.connect('белый', roomId, whiteInit);
  white.send({ type: 'join', lastSeq: 0 });
  await white.take('state');

  const moves = [
    [black, 1, 0],
    [white, 0, 0],
    [black, 0, 1],
  ];
  let seq = 0;
  for (const [who, x, y] of moves) {
    who.send({ type: 'move', seq: ++seq, x, y });
    await black.take('move');
    await white.take('move');
  }

  // После трёх ходов очередь у белых — пасует первым он.
  white.send({ type: 'pass', seq: ++seq });
  await black.take('move');
  black.send({ type: 'pass', seq: ++seq });
  await black.take('scoring');

  black.drain();
  white.drain();
  black.send({ type: 'scoring:accept' });
  await white.take('scoring');
  white.send({ type: 'scoring:accept' });
  const over = await black.take('over');

  const sgf = await fetch(`${HTTP}/rooms/${roomId}/sgf`, {
    headers: { Authorization: `tma ${blackInit}` },
  }).then((r) => r.text());

  black.close();
  white.close();
  return { over, sgf };
}

console.log('--- китайский счёт ---');
const chinese = await playSample('chinese');
check('партия закрыта', chinese.over !== null, JSON.stringify(chinese.over?.result));
// Два своих камня плюс 79 пунктов территории против коми 0.5.
check('камни на доске дают очки', chinese.over?.result === 'B+80.5', chinese.over?.result);
check('в записи китайские правила', chinese.sgf.includes('RU[Chinese]'), chinese.sgf.trim());

console.log('--- японский счёт ---');
const japanese = await playSample('japanese');
check('партия закрыта', japanese.over !== null, JSON.stringify(japanese.over?.result));
// Территория 79 плюс один пленный, свои камни не считаются.
check('очки дают территория и пленные', japanese.over?.result === 'B+79.5', japanese.over?.result);
check('в записи японские правила', japanese.sgf.includes('RU[Japanese]'), japanese.sgf.trim());

check(
  'системы разошлись ровно на два камня минус пленный',
  chinese.over.score.black - japanese.over.score.black === 1,
  `${chinese.over?.score.black} против ${japanese.over?.score.black}`,
);

console.log('--- коми проверяется комнатой ---');
const badKomi = await fetch(`${HTTP}/rooms`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `tma ${blackInit}` },
  body: JSON.stringify({
    settings: {
      size: 9,
      komi: 5.25,
      handicap: 0,
      creatorColor: 'black',
      time: { type: 'none' },
      rules: 'chinese',
    },
  }),
});
check('коми с четвертью отбито', badKomi.status === 400, `статус ${badKomi.status}`);

const hugeKomi = await fetch(`${HTTP}/rooms`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `tma ${blackInit}` },
  body: JSON.stringify({
    settings: {
      size: 9,
      komi: 100,
      handicap: 0,
      creatorColor: 'black',
      time: { type: 'none' },
      rules: 'chinese',
    },
  }),
});
check('коми вне разумного отбито', hugeKomi.status === 400, `статус ${hugeKomi.status}`);

const negativeKomi = await createRoom(blackInit, { komi: -0.5 });
check('отрицательное коми допустимо', typeof negativeKomi === 'string');

console.log('--- старые комнаты без поля правил ---');
const legacy = await fetch(`${HTTP}/rooms`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `tma ${blackInit}` },
  body: JSON.stringify({
    settings: {
      size: 9,
      komi: 5.5,
      handicap: 0,
      creatorColor: 'black',
      time: { type: 'none' },
    },
  }),
}).then((r) => r.json());
check('комната без правил создаётся по-китайски', legacy.settings?.rules === 'chinese', JSON.stringify(legacy.settings?.rules));

report();
