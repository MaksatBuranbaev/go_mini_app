import { toIndex } from '@go/engine';
import { describe, expect, it } from 'vitest';
import {
  FIT_VIEW,
  MARGIN,
  clampView,
  layoutFor,
  pinchView,
  pointAt,
  screenXOf,
  screenYOf,
  starPoints,
} from '../src/board/geometry.js';

/** Обратный перевод экранной координаты в дробную координату доски. */
function boardX(layout: ReturnType<typeof layoutFor>, view: typeof FIT_VIEW, screen: number) {
  return ((screen - view.panX) / view.scale - layout.contentX) / layout.cell - MARGIN;
}

describe('раскладка доски', () => {
  it('вписывает квадрат в короткую сторону и центрует его', () => {
    const layout = layoutFor(19, 400, 700);

    expect(layout.contentSize).toBe(400);
    expect(layout.contentX).toBe(0);
    expect(layout.contentY).toBe(150);
  });

  it('оставляет поле, чтобы краевой камень не срезался', () => {
    const layout = layoutFor(9, 360, 360);
    const edge = screenXOf(layout, FIT_VIEW, 0);

    expect(edge).toBeGreaterThan(layout.cell * 0.5);
    expect(screenXOf(layout, FIT_VIEW, 8)).toBeCloseTo(360 - edge, 6);
  });
});

describe('попадание по пересечению', () => {
  const layout = layoutFor(19, 360, 360);

  it('находит точку прямо под пальцем', () => {
    for (const [x, y] of [
      [0, 0],
      [18, 18],
      [9, 9],
      [3, 15],
    ] as const) {
      const screenX = screenXOf(layout, FIT_VIEW, x);
      const screenY = screenYOf(layout, FIT_VIEW, y);
      expect(pointAt(layout, FIT_VIEW, screenX, screenY)).toBe(toIndex(19, x, y));
    }
  });

  it('округляет промах до ближайшего пересечения, а не отбрасывает его', () => {
    const screenX = screenXOf(layout, FIT_VIEW, 4) + layout.cell * 0.4;
    const screenY = screenYOf(layout, FIT_VIEW, 7) - layout.cell * 0.4;

    expect(pointAt(layout, FIT_VIEW, screenX, screenY)).toBe(toIndex(19, 4, 7));
  });

  it('отдаёт null за пределами доски', () => {
    expect(pointAt(layout, FIT_VIEW, -100, -100)).toBeNull();
    expect(pointAt(layout, FIT_VIEW, 1000, 180)).toBeNull();
  });

  it('учитывает зум и сдвиг', () => {
    const view = clampView(layout, { scale: 2.5, panX: -120, panY: -80 });
    const target = toIndex(19, 12, 5);
    const screenX = screenXOf(layout, view, 12);
    const screenY = screenYOf(layout, view, 5);

    expect(pointAt(layout, view, screenX, screenY)).toBe(target);
  });
});

describe('ограничение вида', () => {
  const layout = layoutFor(13, 300, 500);

  it('на единичном масштабе центрует доску и обнуляет сдвиг', () => {
    const view = clampView(layout, { scale: 1, panX: 240, panY: -310 });

    expect(view.scale).toBe(1);
    expect(view.panX).toBeCloseTo(0, 6);
    expect(view.panY).toBeCloseTo(0, 6);
  });

  it('не даёт увести край доски внутрь экрана', () => {
    const view = clampView(layout, { scale: 3, panX: 10_000, panY: 10_000 });
    const left = layout.contentX * view.scale + view.panX;
    const right = left + layout.contentSize * view.scale;

    expect(left).toBeLessThanOrEqual(0.001);
    expect(right).toBeGreaterThanOrEqual(layout.width - 0.001);
  });

  it('держит масштаб в допустимых границах', () => {
    expect(clampView(layout, { scale: 0.2, panX: 0, panY: 0 }).scale).toBe(1);
    expect(clampView(layout, { scale: 99, panX: 0, panY: 0 }).scale).toBe(3.5);
  });
});

describe('щипок', () => {
  const layout = layoutFor(19, 360, 360);

  it('оставляет точку под пальцами на месте', () => {
    const focalX = 180;
    const focalY = 180;
    const before = boardX(layout, FIT_VIEW, focalX);

    const zoomed = pinchView(layout, FIT_VIEW, focalX, focalY, focalX, focalY, 2);

    expect(zoomed.scale).toBe(2);
    expect(boardX(layout, zoomed, focalX)).toBeCloseTo(before, 6);
  });

  it('едет вслед за пальцами, когда середина щипка смещается', () => {
    const start = clampView(layout, { scale: 2, panX: -100, panY: -100 });
    const grabbed = boardX(layout, start, 200);

    const moved = pinchView(layout, start, 200, 180, 140, 180, 1);

    expect(moved.scale).toBe(2);
    expect(boardX(layout, moved, 140)).toBeCloseTo(grabbed, 6);
  });
});

describe('хоси', () => {
  it('расставляет девять точек на 19x19 и по пять на мелких досках', () => {
    expect(starPoints(19)).toHaveLength(9);
    expect(starPoints(13)).toHaveLength(5);
    expect(starPoints(9)).toHaveLength(5);
  });

  it('ставит тэнгэн в центре', () => {
    expect(starPoints(9)).toContain(toIndex(9, 4, 4));
    expect(starPoints(19)).toContain(toIndex(19, 9, 9));
  });

  it('кладёт угловые хоси на третью линию больших досок и на вторую малых', () => {
    expect(starPoints(19)).toContain(toIndex(19, 3, 3));
    expect(starPoints(9)).toContain(toIndex(9, 2, 2));
  });
});
