// Часы в блице при кривых системных часах устройства.
import { check, report, sleep } from './lib/harness.mjs';
import { Tab } from './lib/tab.mjs';

/** На сколько вкладка A живёт в будущем. */
const SKEW_MS = 180_000;

/**
 * Скрипт ставится до скриптов страницы: приложение должно стартовать уже
 * с кривыми часами, иначе сдвиг посчитается по правильному времени.
 */
const SKEW = `(() => {
  const shift = ${SKEW_MS};
  const RealDate = Date;
  const now = () => RealDate.now() + shift;
  class SkewedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now()])); }
    static now() { return now(); }
  }
  window.Date = SkewedDate;
})()`;

/** «5:00 5:00» -> [300, 300] секунд. */
function seconds(text) {
  return [...(text ?? '').matchAll(/(\d+):(\d\d)/g)].map(([, m, s]) => Number(m) * 60 + Number(s));
}

const a = await Tab.open('A', '/?dev_user=21', { before: SKEW });
await sleep(3000);
const skewSeen = await a.evaluate('Date.now()');
check('часы вкладки A уехали вперёд', skewSeen - Date.now() > SKEW_MS - 5000, `${Math.round((skewSeen - Date.now()) / 1000)} с`);

await a.clickText('Чёрные');
await a.clickText('5 мин + 10 сек');
await a.clickText('Пригласить друга');

const link = await a.waitForText('.invite-link', (t) => t.includes('startapp='));
const roomId = decodeURIComponent(link.split('startapp=')[1]);
console.log('комната:', roomId);
check('в приглашении видно контроль', (await a.body()).includes('5 мин + 10 сек'));

const b = await Tab.open('B', `http://localhost:5173/?dev_user=22&startapp=${encodeURIComponent(roomId)}`);
await sleep(3000);
await b.clickText('Принять');
await sleep(1500);

await a.waitForText('.status-main', (t) => t.includes('Ваш ход'));
await a.send('Page.bringToFront');
const clockA = await a.waitForText('.clocks', (t) => /\d+:\d\d/.test(t));
await b.send('Page.bringToFront');
const clockB = await b.waitForText('.clocks', (t) => /\d+:\d\d/.test(t));
console.log('A видит:', clockA.trim(), '| B видит:', clockB.trim());

const [aBlack, aWhite] = seconds(clockA);
const [bBlack, bWhite] = seconds(clockB);
check('у B обе стороны с полного времени', bBlack > 290 && bWhite === 300, `${bBlack}/${bWhite} с`);
check('кривые часы не съели время у A', aBlack > 290 && aWhite === 300, `${aBlack}/${aWhite} с`);
check('A и B видят одно и то же', Math.abs(aBlack - bBlack) <= 2, `${aBlack} против ${bBlack}`);
await a.shot('40-blitz-skewed-a');

// Время должно убывать у того, чей ход, и стоять у соперника.
await a.send('Page.bringToFront');
await sleep(3000);
const [aBlack2, aWhite2] = seconds(await a.text('.clocks'));
check('часы ходящего тикают вниз', aBlack2 < aBlack, `${aBlack} -> ${aBlack2}`);
check('часы соперника стоят', aWhite2 === aWhite, `${aWhite} -> ${aWhite2}`);

// Возврат из фона: у свёрнутой вкладки таймеры зарезаны, показания обязаны
// догнать реальность сразу, а не через тик.
await b.send('Page.bringToFront');
await sleep(5000);
await a.send('Page.bringToFront');
await sleep(150);
const [aBlackBack] = seconds(await a.text('.clocks'));
check('после возврата из фона часы догнали реальность', aBlackBack <= aBlack2 - 4, `${aBlack2} -> ${aBlackBack}`);

// Ход добавляет инкремент и переводит счёт на соперника.
const point = await a.evaluate(`(() => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  const content = Math.min(r.width, r.height);
  const cell = content / (9 - 1 + 1.5);
  return { x: r.left + (r.width - content) / 2 + (0.75 + 4) * cell,
           y: r.top + (r.height - content) / 2 + (0.75 + 4) * cell };
})()`);
await a.click(point.x, point.y);
await a.click(point.x, point.y);
await sleep(1200);

const clockAfter = await a.text('.clocks');
const [aBlack3, aWhite3] = seconds(clockAfter);
console.log('после хода:', clockAfter.trim());
check('инкремент вернул время ходившему', aBlack3 > aBlackBack, `${aBlackBack} -> ${aBlack3}`);
check('часы переехали к сопернику', aWhite3 < 300, `${aWhite3} с`);
await a.shot('41-blitz-after-move');

report([a, b]);
