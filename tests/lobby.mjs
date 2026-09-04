// Лобби: выбор системы правил, коми руками, пресеты времени по длительности.
import { check, report, sleep } from './lib/harness.mjs';
import { Tab } from './lib/tab.mjs';

const a = await Tab.open('A', '/?dev_user=101');
await sleep(2800);

console.log('--- пресеты времени подписаны длительностью ---');
const presets = await a.evaluate(
  `[...document.querySelectorAll('.time-preset')].map((b) => b.textContent.trim())`,
);
check('пресеты подписаны оценкой партии', presets[0]?.startsWith('~ 5 мин'), presets.join(' | '));
check('в подписи виден сам контроль', presets[0]?.includes('30 сек + 5 сек'), presets[0] ?? '');
check('без часов отдельной строкой', presets.at(-1)?.includes('Без часов'), presets.at(-1) ?? '');

// Оценка считается от доски: те же секунды на 19×19 — совсем другая партия.
await a.clickText('19×19');
await sleep(300);
const big = await a.evaluate(
  `document.querySelector('.time-preset').textContent.trim()`,
);
check('на большой доске оценка выросла', !big.startsWith('~ 5 мин'), big);
await a.clickText('9×9');
await sleep(300);

console.log('--- коми ---');
check('по умолчанию коми автоматическое', (await a.text('.stepper-value'))?.includes('авто'), await a.text('.stepper-value'));
check('для 9×9 по-китайски это 5.5', (await a.text('.stepper-value'))?.startsWith('5.5'), await a.text('.stepper-value'));

await a.clickText('19×19');
await sleep(300);
check('коми следует за доской, пока его не трогали', (await a.text('.stepper-value'))?.startsWith('7.5'), await a.text('.stepper-value'));

await a.clickText('+');
await sleep(300);
const raised = await a.text('.stepper-value');
check('плюс поднимает на половину очка', raised?.startsWith('8'), raised ?? '');
check('автоподстановка выключилась', !raised?.includes('авто'), raised ?? '');

await a.clickText('9×9');
await sleep(300);
check('заданное руками коми не затирается доской', (await a.text('.stepper-value'))?.startsWith('8'), await a.text('.stepper-value'));

await a.clickText('сбросить');
await sleep(300);
check('сброс возвращает автоматическое', (await a.text('.stepper-value'))?.includes('авто'), await a.text('.stepper-value'));

console.log('--- система правил ---');
await a.clickText('Японские');
await sleep(300);
check('подпись объясняет выбор', (await a.body()).includes('Территория плюс пленные'));
check('коми по японским правилам на 9×9 то же', (await a.text('.stepper-value'))?.startsWith('5.5'), await a.text('.stepper-value'));

await a.clickText('19×19');
await sleep(300);
check('на 19×19 японское коми ниже китайского', (await a.text('.stepper-value'))?.startsWith('6.5'), await a.text('.stepper-value'));
await a.shot('lobby-rules');

console.log('--- выбор доезжает до комнаты ---');
await a.clickContains('30 сек + 5 сек');
await a.clickText('Пригласить друга');
await a.waitForText('.status-main', (t) => t.includes('Ждём соперника'));
const invite = await a.body();
check('в комнате японские правила', invite.includes('Японские'), invite.split('\n').slice(0, 12).join(' / '));
check('в комнате выбранное коми', invite.includes('6.5'), invite.split('\n').slice(0, 12).join(' / '));
check('в комнате выбранный контроль', invite.includes('30 сек + 5 сек'), invite.split('\n').slice(0, 12).join(' / '));

report([a]);
