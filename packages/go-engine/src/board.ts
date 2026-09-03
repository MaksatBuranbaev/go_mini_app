import { EMPTY } from './types.js';

export function toIndex(size: number, x: number, y: number): number {
  return y * size + x;
}

export function xOf(size: number, index: number): number {
  return index % size;
}

export function yOf(size: number, index: number): number {
  return (index / size) | 0;
}

export function onBoard(size: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

/** Записывает соседей точки в `out` и возвращает их количество (2–4). */
export function neighbors(size: number, index: number, out: Int32Array): number {
  const x = index % size;
  const y = (index / size) | 0;
  let n = 0;
  if (x > 0) out[n++] = index - 1;
  if (x < size - 1) out[n++] = index + 1;
  if (y > 0) out[n++] = index - size;
  if (y < size - 1) out[n++] = index + size;
  return n;
}

interface Scratch {
  mark: Int32Array;
  stack: Int32Array;
  neighbors: Int32Array;
  generation: number;
}

const scratches = new Map<number, Scratch>();

/**
 * Буферы переиспользуются между вызовами: посещённые точки помечаются номером
 * поколения, а не очищаются. На 19×19 партию приходится ~250 обходов, аллокации
 * в этом месте съедали бы заметную долю бюджета в 10 мс на вызов Worker'а.
 */
function scratchFor(size: number): Scratch {
  let scratch = scratches.get(size);
  if (!scratch) {
    scratch = {
      mark: new Int32Array(size * size),
      stack: new Int32Array(size * size),
      neighbors: new Int32Array(4),
      generation: 0,
    };
    scratches.set(size, scratch);
  }
  return scratch;
}

export interface GroupInfo {
  /** Сколько камней группы записано в переданный `outStones`. */
  count: number;
  liberties: number;
}

/**
 * Обходит группу камней, связанную с точкой `start`, и заполняет `outStones`
 * её индексами. Дамэ считаются точно, без ранних выходов: вызывающему коду
 * нужно и число свобод, и сами камни для снятия.
 */
export function groupAt(
  board: Uint8Array,
  size: number,
  start: number,
  outStones: Int32Array,
): GroupInfo {
  const color = board[start]!;
  if (color === EMPTY) return { count: 0, liberties: 0 };

  const scratch = scratchFor(size);
  const { mark, stack, neighbors: nbuf } = scratch;
  const generation = ++scratch.generation;

  let stackSize = 0;
  let count = 0;
  let liberties = 0;

  stack[stackSize++] = start;
  mark[start] = generation;

  while (stackSize > 0) {
    const index = stack[--stackSize]!;
    outStones[count++] = index;

    const n = neighbors(size, index, nbuf);
    for (let k = 0; k < n; k++) {
      const next = nbuf[k]!;
      if (mark[next] === generation) continue;
      const stone = board[next]!;
      if (stone === EMPTY) {
        mark[next] = generation;
        liberties++;
      } else if (stone === color) {
        mark[next] = generation;
        stack[stackSize++] = next;
      }
      // Чужой камень помечать нельзя: он может граничить с несколькими нашими
      // цепочками, и пометка исказила бы обход соседней группы.
    }
  }

  return { count, liberties };
}

/** Есть ли у группы хотя бы одно дамэ. Короче и дешевле полного обхода. */
export function hasLiberty(board: Uint8Array, size: number, start: number): boolean {
  const stones = new Int32Array(size * size);
  return groupAt(board, size, start, stones).liberties > 0;
}
