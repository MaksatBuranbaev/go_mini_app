/** Общее для всех сквозных прогонов: счёт проверок и итоговый отчёт. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;

export function check(label, ok, detail = '') {
  console.log(`${ok ? '  ок  ' : 'ПРОВАЛ'} | ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** Печатает ошибки страниц, итог и выходит с кодом для CI. */
export function report(tabs = []) {
  if (tabs.length > 0) {
    console.log('--- ошибки страниц ---');
    for (const tab of tabs) for (const line of tab.logs) console.log(tab.label, line);
  }
  console.log(failures === 0 ? '\nВСЁ ЗЕЛЁНОЕ' : `\nПРОВАЛОВ: ${failures}`);
  for (const tab of tabs) tab.ws?.close();
  process.exit(failures === 0 ? 0 : 1);
}
