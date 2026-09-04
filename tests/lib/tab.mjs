import { writeFileSync } from 'node:fs';
import { CDP, WEB } from './config.mjs';
import { sleep } from './harness.mjs';

/**
 * Вкладка настоящего браузера по Chrome DevTools Protocol.
 *
 * Прогоны нарочно идут через реальный ввод и реальные пиксели: доска — канва,
 * и половина её ошибок (промахи по пересечениям, замерший кадр, разъехавшаяся
 * раскладка) в jsdom не воспроизводится вовсе.
 */
export class Tab {
  constructor(label, ws, size) {
    this.label = label;
    this.ws = ws;
    this.size = size;
    this.nextId = 1;
    this.waiting = new Map();
    this.logs = [];
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
  }

  /**
   * @param {string} label
   * @param {string} path путь внутри мини-аппа либо полный URL
   * @param {{ size?: number, before?: string }} options
   *   `before` — скрипт, который выполнится до скриптов страницы.
   */
  static async open(label, path, options = {}) {
    const { size = 9, before } = options;
    const url = path.startsWith('http') || path === 'about:blank' ? path : `${WEB}${path}`;
    const first = before ? 'about:blank' : url;

    const target = await (
      await fetch(`${CDP}/json/new?${encodeURIComponent(first)}`, { method: 'PUT' })
    ).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    const tab = new Tab(label, ws, size);
    await tab.send('Runtime.enable');
    await tab.send('Page.enable');
    await tab.send('Network.enable');
    if (before) {
      await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: before });
      await tab.send('Page.navigate', { url });
    }
    return tab;
  }

  onMessage(message) {
    if (message.id && this.waiting.has(message.id)) {
      const pending = this.waiting.get(message.id);
      this.waiting.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      this.logs.push(`EXC ${details.exception?.description ?? details.text}`);
    }
    if (message.method === 'Page.javascriptDialogOpening') {
      this.ws.send(
        JSON.stringify({
          id: this.nextId++,
          method: 'Page.handleJavaScriptDialog',
          params: { accept: true },
        }),
      );
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }));
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(`${this.label}: ${details.exception?.description ?? details.text}`);
    }
    return result.result.value;
  }

  /** Разрыв сети только у этой вкладки: сокет умирает, страница живёт. */
  offline(value) {
    return this.send('Network.emulateNetworkConditions', {
      offline: value,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  }

  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await sleep(30);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await sleep(170);
  }

  /** Ищет самый глубокий узел с таким текстом: у ячеек список обёрток. */
  async elementBox(text, selector = 'button') {
    return this.evaluate(`(() => {
      const all = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .filter((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled);
      const el = all[all.length - 1];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
  }

  async clickText(text, selector = 'button', tries = 40) {
    for (let i = 0; i < tries; i++) {
      const box = await this.elementBox(text, selector);
      if (box) return this.click(box.x, box.y);
      await sleep(300);
    }
    const screen = await this.evaluate('document.body.innerText.slice(0,400)');
    throw new Error(`${this.label}: нет «${text}». Экран:\n${screen}`);
  }

  /** Кнопка по началу текста: подпись пресета склеена из двух строк. */
  async clickStartsWith(prefix, selector = 'button', tries = 40) {
    for (let i = 0; i < tries; i++) {
      const box = await this.evaluate(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .find((x) => x.textContent.trim().startsWith(${JSON.stringify(prefix)}) && !x.disabled);
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      if (box) return this.click(box.x, box.y);
      await sleep(300);
    }
    const screen = await this.evaluate('document.body.innerText.slice(0,400)');
    throw new Error(`${this.label}: нет «${prefix}…». Экран:\n${screen}`);
  }

  /** Кнопка по куску текста: у пресета подпись склеена из двух строк. */
  async clickContains(part, selector = 'button', tries = 40) {
    for (let i = 0; i < tries; i++) {
      const box = await this.evaluate(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .find((x) => x.textContent.includes(${JSON.stringify(part)}) && !x.disabled);
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      if (box) return this.click(box.x, box.y);
      await sleep(300);
    }
    const screen = await this.evaluate('document.body.innerText.slice(0,400)');
    throw new Error(`${this.label}: нет кнопки с «${part}». Экран:
${screen}`);
  }

  buttons() {
    return this.evaluate(`[...document.querySelectorAll('button')].map((b) => b.textContent.trim())`);
  }

  text(selector) {
    return this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  }

  body() {
    return this.evaluate('document.body.innerText');
  }

  async waitForText(selector, predicate, tries = 40) {
    for (let i = 0; i < tries; i++) {
      const value = await this.text(selector);
      if (value && predicate(value)) return value;
      await sleep(300);
    }
    throw new Error(`${this.label}: не дождались ${selector}. Экран:\n${await this.body()}`);
  }

  /** Снимок доски. Перед чтением вкладку выводим вперёд: в фоне rAF не идёт. */
  async boardImage() {
    await this.send('Page.bringToFront');
    await sleep(350);
    return this.evaluate(`document.querySelector('canvas')?.toDataURL() ?? null`);
  }

  async intersection(gx, gy) {
    return this.evaluate(`(() => {
      const c = document.querySelector('canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const content = Math.min(r.width, r.height);
      const cell = content / (${this.size} - 1 + 1.5);
      return { x: r.left + (r.width - content) / 2 + (0.75 + ${gx}) * cell,
               y: r.top + (r.height - content) / 2 + (0.75 + ${gy}) * cell };
    })()`);
  }

  /** Ход: два тапа по одной точке — прицел и подтверждение. */
  async tap(gx, gy, times = 2) {
    await this.send('Page.bringToFront');
    const point = await this.intersection(gx, gy);
    if (!point) throw new Error(`${this.label}: доски нет`);
    for (let i = 0; i < times; i++) await this.click(point.x, point.y);
  }

  async shot(name) {
    await this.send('Page.bringToFront');
    await sleep(250);
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${name}.png`, Buffer.from(data, 'base64'));
  }
}
