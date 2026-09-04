import { toIndex, xOf, yOf } from './board.js';
import { BLACK, WHITE, type Color, type Move, type ScoringRules } from './types.js';

export interface RecordedMove {
  color: Color;
  move: Move;
}

export interface GameRecord {
  size: number;
  komi: number;
  handicap: number;
  /** Система подсчёта: `RU[Chinese]` или `RU[Japanese]` в записи. */
  rules?: ScoringRules;
  result?: string;
  /** Камни, расставленные до игры: фора (AB) и правки позиции (AW). */
  setup?: { black: number[]; white: number[] };
  moves: RecordedMove[];
  players?: { black?: string; white?: string };
  date?: string;
}

const A = 'a'.charCodeAt(0);

export function toSgfPoint(size: number, index: number): string {
  return String.fromCharCode(A + xOf(size, index), A + yOf(size, index));
}

export function fromSgfPoint(size: number, value: string): number | null {
  if (value.length < 2) return null;
  const x = value.charCodeAt(0) - A;
  const y = value.charCodeAt(1) - A;
  if (x < 0 || y < 0 || x >= size || y >= size) return null;
  return toIndex(size, x, y);
}

export function toSgf(record: GameRecord): string {
  const parts = [
    'GM[1]',
    'FF[4]',
    'CA[UTF-8]',
    'AP[go-mini-app]',
    `SZ[${record.size}]`,
    `KM[${record.komi}]`,
  ];
  if (record.handicap >= 2) parts.push(`HA[${record.handicap}]`);
  if (record.rules) parts.push(`RU[${record.rules === 'japanese' ? 'Japanese' : 'Chinese'}]`);
  if (record.players?.black) parts.push(`PB[${escapeValue(record.players.black)}]`);
  if (record.players?.white) parts.push(`PW[${escapeValue(record.players.white)}]`);
  if (record.date) parts.push(`DT[${record.date}]`);
  if (record.result) parts.push(`RE[${record.result}]`);

  const setup = record.setup;
  if (setup?.black.length) {
    parts.push(`AB${setup.black.map((p) => `[${toSgfPoint(record.size, p)}]`).join('')}`);
  }
  if (setup?.white.length) {
    parts.push(`AW${setup.white.map((p) => `[${toSgfPoint(record.size, p)}]`).join('')}`);
  }

  // Сдача в SGF отражается только результатом партии, отдельного хода для неё нет.
  const moves = record.moves
    .map((entry) => {
      const tag = entry.color === BLACK ? 'B' : 'W';
      if (entry.move.type === 'resign') return '';
      if (entry.move.type === 'pass') return `;${tag}[]`;
      const index = toIndex(record.size, entry.move.x, entry.move.y);
      return `;${tag}[${toSgfPoint(record.size, index)}]`;
    })
    .join('');

  return `(;${parts.join('')}${moves})\n`;
}

type Properties = Map<string, string[]>;

export function fromSgf(text: string): GameRecord {
  const nodes = parseMainLine(text);
  const root: Properties = nodes[0] ?? new Map();

  const size = Number(first(root, 'SZ') ?? 19);
  const handicap = Number(first(root, 'HA') ?? 0);

  const record: GameRecord = {
    size,
    komi: parseKomi(first(root, 'KM')),
    handicap,
    moves: [],
  };

  const rules = parseRules(first(root, 'RU'));
  if (rules) record.rules = rules;

  const result = first(root, 'RE');
  if (result) record.result = result;
  const date = first(root, 'DT');
  if (date) record.date = date;

  const black = first(root, 'PB');
  const white = first(root, 'PW');
  if (black || white) record.players = { ...(black && { black }), ...(white && { white }) };

  const setupBlack = points(root, 'AB', size);
  const setupWhite = points(root, 'AW', size);
  if (setupBlack.length || setupWhite.length) {
    record.setup = { black: setupBlack, white: setupWhite };
  }

  for (const node of nodes.slice(1)) {
    for (const [tag, color] of [
      ['B', BLACK],
      ['W', WHITE],
    ] as const) {
      const values = node.get(tag);
      if (!values) continue;
      const value = values[0] ?? '';
      // Пустое значение и «tt» на досках до 19×19 — общепринятые записи паса.
      if (value === '' || (size <= 19 && value === 'tt')) {
        record.moves.push({ color, move: { type: 'pass' } });
        continue;
      }
      const index = fromSgfPoint(size, value);
      if (index === null) continue;
      record.moves.push({
        color,
        move: { type: 'play', x: xOf(size, index), y: yOf(size, index) },
      });
    }
  }

  return record;
}

/**
 * Коми из чужих записей.
 *
 * Единого формата у экспортёров нет: gokifu и часть сервисов пишет значение
 * умноженным на сто — `KM[650]` вместо `KM[6.5]`, — а европейские редакторы
 * ставят запятую вместо точки. Коми больше сотни в реальной партии не бывает,
 * поэтому такое значение однозначно читается как сотые.
 */
/**
 * Система подсчёта из `RU[]`. Значений там встречается много (AGA, NZ, Ing),
 * но нас интересует одно различие: считаем территорию или площадь.
 */
export function parseRules(raw: string | undefined): ScoringRules | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (value.startsWith('japanese')) return 'japanese';
  if (value.startsWith('chinese')) return 'chinese';
  return undefined;
}

export function parseKomi(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const value = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value) >= 100 ? value / 100 : value;
}

function first(properties: Properties, key: string): string | undefined {
  return properties.get(key)?.[0];
}

function points(properties: Properties, key: string, size: number): number[] {
  const values = properties.get(key) ?? [];
  return values
    .map((value) => fromSgfPoint(size, value))
    .filter((index): index is number => index !== null);
}

/**
 * Из дерева партии берётся только главная ветка: первый вариант в каждой развилке.
 * Разбор вариаций нужен разбору партий, а не игре, и появится вместе с ним.
 */
function parseMainLine(text: string): Properties[] {
  const nodes: Properties[] = [];
  let i = 0;

  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };

  const readValue = (): string => {
    i++; // '['
    let value = '';
    while (i < text.length && text[i] !== ']') {
      if (text[i] === '\\') i++;
      value += text[i];
      i++;
    }
    i++; // ']'
    return value;
  };

  skipSpace();
  if (text[i] !== '(') return nodes;
  i++;

  while (i < text.length) {
    skipSpace();
    const char = text[i];

    if (char === ';') {
      i++;
      const properties: Properties = new Map();
      while (i < text.length) {
        skipSpace();
        const start = i;
        while (i < text.length && /[A-Z]/.test(text[i]!)) i++;
        if (i === start) break;
        const key = text.slice(start, i);
        const values: string[] = [];
        for (;;) {
          skipSpace();
          if (text[i] !== '[') break;
          values.push(readValue());
        }
        properties.set(key, values);
      }
      nodes.push(properties);
      continue;
    }

    if (char === '(') {
      // Первая ветка продолжает главную линию, остальные пропускаем целиком.
      const inner = parseMainLine(text.slice(i));
      nodes.push(...inner);
      break;
    }

    if (char === ')' || char === undefined) break;
    i++;
  }

  return nodes;
}

function escapeValue(value: string): string {
  return value.replace(/([\\\]])/g, '\\$1');
}
