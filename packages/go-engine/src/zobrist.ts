import { BLACK, type Color } from './types.js';

const MASK64 = (1n << 64n) - 1n;

/**
 * splitmix64 с фиксированным seed. Детерминированность обязательна: хеши позиций
 * ездят между браузером и комнатой, любое расхождение таблиц сломает проверку суперко.
 */
function splitmix64(seed: bigint): () => bigint {
  let state = seed & MASK64;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return (z ^ (z >> 31n)) & MASK64;
  };
}

const tables = new Map<number, BigUint64Array>();

function tableFor(size: number): BigUint64Array {
  let table = tables.get(size);
  if (!table) {
    const next = splitmix64(0x9e3779b97f4a7c15n ^ BigInt(size));
    table = new BigUint64Array(size * size * 2);
    for (let i = 0; i < table.length; i++) table[i] = next();
    tables.set(size, table);
  }
  return table;
}

/** Хеш-вклад камня цвета `color` в точке `index`. XOR-им и при постановке, и при снятии. */
export function stoneHash(size: number, index: number, color: Color): bigint {
  const table = tableFor(size);
  return table[index * 2 + (color === BLACK ? 0 : 1)]!;
}

/** Хеш позиции с нуля — для восстановления состояния из доски. */
export function hashBoard(size: number, board: Uint8Array): bigint {
  let hash = 0n;
  for (let i = 0; i < board.length; i++) {
    const stone = board[i]!;
    if (stone !== 0) hash ^= stoneHash(size, i, stone as Color);
  }
  return hash;
}
