// Лобби: выбор системы правил, коми руками, пресеты времени по длительности.
import { check, report, sleep } from './lib/harness.mjs';
import { Tab } from './lib/tab.mjs';

const a = await Tab.open('A', '/?dev_user=101');
await sleep(2800);

console.log('--- лестница времени зависит от доски ---');
const tiers = () =>
  a.evaluate(`[...document.querySelectorAll('.time-tier-label')].map((e) => e.textContent).join('|')`);
const presets = () =>
  a.evaluate(`[...document.querySelectorAll('.time-preset')].map((e) => e.textContent).join('|')`);
const chosen = () => a.text('.time-preset-on');

check('ступени 9×9 подписаны длительностью', (await tiers()) === '~ 5 мин|~ 10 мин|~ 20 мин|Сколько понадобится', await tiers());
check(
  'в ступени два варианта: с добавкой и с бёёми',
  (await presets()).startsWith('30 сек + 5 сек|30 сек + 5×10 сек|'),
  await presets(),
);
check('без часов отдельной ступенью', (await presets()).endsWith('|Без часов'), await presets());

// Те же секунды на 19×19 — совсем другая партия, поэтому и лестница другая.
await a.clickText('19×19');
await sleep(300);
check('на большой доске ступени длиннее', (await tiers()) === '~ 20 мин|~ 40 мин|~ 1 ч|Сколько понадобится', await tiers());
check('и сами контроли другие', (await presets()).includes('10 мин + 10 сек'), await presets());

// Выбор держится за ступень, а не за номер в общем списке: при смене доски
// игрок остаётся на партии той же длины.
await a.clickText('10 мин + 5×20 сек');
await sleep(300);
await a.clickText('9×9');
await sleep(300);
check('смена доски сохраняет ступень и вид контроля', (await chosen()) === '5 мин + 5×20 сек', String(await chosen()));
await a.clickText('2 мин + 7 сек');
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

console.log('--- тёмная тема клиента ---');
const d = await Tab.open('D', '/?dev_user=108&dev_theme=dark');
await d.send('Page.bringToFront');
await sleep(2800);
await d.waitForText('.lobby', (t) => t.includes('Размер доски'));
check('приложение узнало тёмную тему', (await d.evaluate('document.documentElement.dataset.theme')) === 'dark');

// Тёмную палитру клиент отдаёт переменными, но тему компонентов telegram-ui
// держит у себя: без явной установки надписи кнопок оставались чёрными на
// тёмной карточке. Проверяем не цвет, а то, что текст светлее подложки.
const contrast = await d.evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '13×13');
  const light = (color) => {
    const [r, g, b] = color.split('(')[1].split(')')[0].split(',').map(Number);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };
  const header = [...document.querySelectorAll('header > *')][0];
  return {
    text: light(getComputedStyle(button).color),
    // Подложка карточки лежит на внутреннем слое секции — на самой секции фона нет.
    card: light(getComputedStyle(button.closest('section').firstElementChild).backgroundColor),
    raw: getComputedStyle(button).color + ' на ' + getComputedStyle(button.closest('section').firstElementChild).backgroundColor,
    header: getComputedStyle(header).color,
    hint: getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-hint-color').trim(),
    accent: getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-accent-text-color').trim(),
  };
})()`);
check('текст кнопки светлее карточки', contrast.text - contrast.card > 0.4, JSON.stringify(contrast));
check('заголовок секции не кричит акцентом', contrast.header === 'rgb(112, 132, 153)', `${contrast.header} при акценте ${contrast.accent}`);
await d.shot('lobby-dark');

console.log('--- выбор доезжает до комнаты ---');
await a.clickContains('30 сек + 5 сек');
await a.clickText('Пригласить друга');
await a.waitForText('.status-main', (t) => t.includes('Ждём соперника'));
const invite = await a.body();
check('в комнате японские правила', invite.includes('Японские'), invite.split('\n').slice(0, 12).join(' / '));
check('в комнате выбранное коми', invite.includes('6.5'), invite.split('\n').slice(0, 12).join(' / '));
check('в комнате выбранный контроль', invite.includes('30 сек + 5 сек'), invite.split('\n').slice(0, 12).join(' / '));

report([a, d]);
