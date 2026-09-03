import { describe, expect, it } from 'vitest';
import { BLACK, WHITE, fromSgf, replay, toSgf, type GameRecord } from '../src/index.js';

describe('чтение SGF', () => {
  it('разбирает заголовок и ходы', () => {
    const record = fromSgf('(;GM[1]FF[4]SZ[9]KM[5.5]RE[B+2.5]PB[Чёрные]PW[Белые];B[cc];W[gg];B[])');

    expect(record.size).toBe(9);
    expect(record.komi).toBe(5.5);
    expect(record.result).toBe('B+2.5');
    expect(record.players).toEqual({ black: 'Чёрные', white: 'Белые' });
    expect(record.moves).toEqual([
      { color: BLACK, move: { type: 'play', x: 2, y: 2 } },
      { color: WHITE, move: { type: 'play', x: 6, y: 6 } },
      { color: BLACK, move: { type: 'pass' } },
    ]);
  });

  it('понимает пас, записанный как tt', () => {
    const record = fromSgf('(;SZ[19];B[tt])');
    expect(record.moves[0]?.move).toEqual({ type: 'pass' });
  });

  it('читает камни форы из AB', () => {
    const record = fromSgf('(;SZ[9]HA[2]AB[cc][gg];W[ee])');
    expect(record.handicap).toBe(2);
    expect(record.setup?.black).toHaveLength(2);
    expect(record.moves).toHaveLength(1);
  });

  it('идёт по главной ветке и игнорирует вариации', () => {
    const record = fromSgf('(;SZ[9];B[cc](;W[gg];B[ee])(;W[dd];B[ff]))');
    expect(record.moves.map((entry) => entry.move)).toEqual([
      { type: 'play', x: 2, y: 2 },
      { type: 'play', x: 6, y: 6 },
      { type: 'play', x: 4, y: 4 },
    ]);
  });

  it('переваривает переносы строк и пробелы между узлами', () => {
    const record = fromSgf('(\n;SZ[9]\nKM[6.5]\n;B[aa]\n;W[bb]\n)\n');
    expect(record.komi).toBe(6.5);
    expect(record.moves).toHaveLength(2);
  });
});

describe('запись SGF', () => {
  it('переживает круг «запись → чтение» без потерь', () => {
    const record: GameRecord = {
      size: 13,
      komi: 6.5,
      handicap: 0,
      result: 'W+3.5',
      players: { black: 'Аня', white: 'Боря' },
      moves: [
        { color: BLACK, move: { type: 'play', x: 3, y: 3 } },
        { color: WHITE, move: { type: 'play', x: 9, y: 9 } },
        { color: BLACK, move: { type: 'pass' } },
        { color: WHITE, move: { type: 'pass' } },
      ],
    };

    const parsed = fromSgf(toSgf(record));

    expect(parsed.size).toBe(record.size);
    expect(parsed.komi).toBe(record.komi);
    expect(parsed.result).toBe(record.result);
    expect(parsed.players).toEqual(record.players);
    expect(parsed.moves).toEqual(record.moves);
  });

  it('не пишет сдачу отдельным ходом', () => {
    const text = toSgf({
      size: 9,
      komi: 5.5,
      handicap: 0,
      result: 'W+R',
      moves: [
        { color: BLACK, move: { type: 'play', x: 2, y: 2 } },
        { color: WHITE, move: { type: 'resign' } },
      ],
    });

    expect(text).toContain('RE[W+R]');
    expect(text).toContain(';B[cc]');
    expect(text.match(/;W\[/)).toBeNull();
  });

  it('записанные ходы принимаются движком', () => {
    const record = fromSgf('(;SZ[9]KM[5.5];B[cc];W[gg];B[gc];W[cg])');
    const result = replay({ size: record.size, komi: record.komi }, record.moves.map((m) => m.move));
    expect(result.ok).toBe(true);
  });
});
