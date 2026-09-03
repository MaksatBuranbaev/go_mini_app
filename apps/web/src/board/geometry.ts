import { toIndex } from '@go/engine';

/** Поле вокруг сетки, в клетках: краевой камень не должен срезаться о край доски. */
export const MARGIN = 0.75;

export const MIN_SCALE = 1;
export const MAX_SCALE = 3.5;

/**
 * Раскладка доски при масштабе 1: квадрат вписан в канву и отцентрован.
 * Пересчитывается только на ресайзе, зум её не трогает.
 */
export interface BoardLayout {
  size: number;
  width: number;
  height: number;
  /** Расстояние между линиями сетки в CSS-пикселях. */
  cell: number;
  contentX: number;
  contentY: number;
  contentSize: number;
}

/** Зум и сдвиг поверх раскладки. Единичное значение — доска целиком по центру. */
export interface View {
  scale: number;
  panX: number;
  panY: number;
}

export const FIT_VIEW: View = { scale: 1, panX: 0, panY: 0 };

export function layoutFor(size: number, width: number, height: number): BoardLayout {
  const contentSize = Math.min(width, height);
  return {
    size,
    width,
    height,
    cell: contentSize / (size - 1 + 2 * MARGIN),
    contentX: (width - contentSize) / 2,
    contentY: (height - contentSize) / 2,
    contentSize,
  };
}

export function screenXOf(layout: BoardLayout, view: View, x: number): number {
  return (layout.contentX + (MARGIN + x) * layout.cell) * view.scale + view.panX;
}

export function screenYOf(layout: BoardLayout, view: View, y: number): number {
  return (layout.contentY + (MARGIN + y) * layout.cell) * view.scale + view.panY;
}

/** Шаг сетки на экране с учётом зума — от него считаются все радиусы отрисовки. */
export function screenCell(layout: BoardLayout, view: View): number {
  return layout.cell * view.scale;
}

/**
 * Держит доску в кадре: пока она меньше канвы — центрирует, когда больше —
 * не даёт увести её край внутрь экрана.
 */
export function clampView(layout: BoardLayout, view: View): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
  return {
    scale,
    panX: clampAxis(layout.contentX, layout.contentSize, layout.width, scale, view.panX),
    panY: clampAxis(layout.contentY, layout.contentSize, layout.height, scale, view.panY),
  };
}

function clampAxis(
  content: number,
  contentSize: number,
  viewport: number,
  scale: number,
  pan: number,
): number {
  const scaled = contentSize * scale;
  const base = content * scale;
  if (scaled <= viewport) return (viewport - scaled) / 2 - base;
  return Math.min(-base, Math.max(viewport - scaled - base, pan));
}

/**
 * Масштабирование щипком. Точка доски, оказавшаяся под серединой пальцев в начале
 * жеста, остаётся под ней и после: пальцы обычно и разъезжаются, и едут вбок,
 * поэтому зум и сдвиг считаются одной формулой, а не по очереди.
 */
export function pinchView(
  layout: BoardLayout,
  start: View,
  startFocalX: number,
  startFocalY: number,
  focalX: number,
  focalY: number,
  factor: number,
): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, start.scale * factor));
  const ratio = scale / start.scale;
  return clampView(layout, {
    scale,
    panX: focalX - (startFocalX - start.panX) * ratio,
    panY: focalY - (startFocalY - start.panY) * ratio,
  });
}

/** Меняет масштаб так, чтобы точка под пальцем осталась на месте. */
export function zoomAt(
  layout: BoardLayout,
  view: View,
  focalX: number,
  focalY: number,
  factor: number,
): View {
  return pinchView(layout, view, focalX, focalY, focalX, focalY, factor);
}

/**
 * Пересечение под пальцем или `null`, если тап пришёлся мимо доски.
 *
 * Берётся ближайшее пересечение, а не попадание в клетку: палец на 19×19
 * накрывает три пункта, и «мимо» здесь — не точность, а промах игрока.
 * Радиус приёма не опускается ниже 24 CSS-пикселей даже на мелкой сетке.
 */
export function pointAt(
  layout: BoardLayout,
  view: View,
  screenX: number,
  screenY: number,
): number | null {
  const { size, cell } = layout;
  const x = Math.round(((screenX - view.panX) / view.scale - layout.contentX) / cell - MARGIN);
  const y = Math.round(((screenY - view.panY) / view.scale - layout.contentY) / cell - MARGIN);
  if (x < 0 || y < 0 || x >= size || y >= size) return null;

  const tolerance = Math.max(screenCell(layout, view) * 0.9, 24);
  const dx = screenXOf(layout, view, x) - screenX;
  const dy = screenYOf(layout, view, y) - screenY;
  if (dx * dx + dy * dy > tolerance * tolerance) return null;

  return toIndex(size, x, y);
}

/** Хоси: 9 точек на 19×19, по пять на 13×13 и 9×9. */
export function starPoints(size: number): number[] {
  const edge = size >= 13 ? 3 : 2;
  const far = size - 1 - edge;
  const mid = (size - 1) / 2;
  const at = (x: number, y: number) => toIndex(size, x, y);

  if (size === 19) {
    const lines = [edge, mid, far];
    return lines.flatMap((y) => lines.map((x) => at(x, y)));
  }
  if (size % 2 === 1 && size >= 9) {
    return [at(edge, edge), at(far, edge), at(edge, far), at(far, far), at(mid, mid)];
  }
  return [];
}
