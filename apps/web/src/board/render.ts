import { BLACK, EMPTY, WHITE, type Color } from '@go/engine';
import {
  screenCell,
  screenXOf,
  screenYOf,
  starPoints,
  type BoardLayout,
  type View,
} from './geometry.js';

export interface BoardTheme {
  wood: string;
  line: string;
  star: string;
  accent: string;
  illegal: string;
}

/**
 * Доска остаётся деревянной в обеих темах: чёрные и белые камни читаются только
 * на среднем тоне, и подстройка фона под тему Telegram сожрала бы их контраст.
 * Меняется яркость дерева, а не сам цвет.
 */
export function themeFor(dark: boolean): BoardTheme {
  return dark
    ? { wood: '#8a6a41', line: '#241a0a', star: '#241a0a', accent: '#54a9ff', illegal: '#e05c4b' }
    : { wood: '#e5b96b', line: '#4a3418', star: '#4a3418', accent: '#2f7fd4', illegal: '#c8362a' };
}

export interface BoardScene {
  layout: BoardLayout;
  view: View;
  theme: BoardTheme;
  board: Uint8Array;
  /** Последний сыгранный ход: подсвечивается кружком поверх камня. */
  lastMove: number | null;
  pending: number | null;
  pendingColor: Color;
  /** Точка, отвергнутая правилами: красное кольцо вместо призрака. */
  rejected: number | null;
  dead: ReadonlySet<number>;
  /** Карта владельцев из движка. Заполнена только в фазе подсчёта. */
  owners: Uint8Array | null;
}

export function drawBoard(ctx: CanvasRenderingContext2D, scene: BoardScene): void {
  const cell = screenCell(scene.layout, scene.view);

  ctx.clearRect(0, 0, scene.layout.width, scene.layout.height);
  drawWood(ctx, scene);
  drawGrid(ctx, scene, cell);
  drawStars(ctx, scene, cell);
  if (scene.owners) drawTerritory(ctx, scene, cell);
  drawStones(ctx, scene, cell);
  drawLastMove(ctx, scene, cell);
  drawPending(ctx, scene, cell);
}

function drawWood(ctx: CanvasRenderingContext2D, scene: BoardScene): void {
  const { layout, view, theme } = scene;
  const x = layout.contentX * view.scale + view.panX;
  const y = layout.contentY * view.scale + view.panY;
  const side = layout.contentSize * view.scale;

  ctx.fillStyle = theme.wood;
  ctx.beginPath();
  ctx.roundRect(x, y, side, side, Math.min(12, side * 0.02));
  ctx.fill();
}

function drawGrid(ctx: CanvasRenderingContext2D, scene: BoardScene, cell: number): void {
  const { layout, view, theme } = scene;
  const last = layout.size - 1;
  const left = screenXOf(layout, view, 0);
  const right = screenXOf(layout, view, last);
  const top = screenYOf(layout, view, 0);
  const bottom = screenYOf(layout, view, last);

  ctx.strokeStyle = theme.line;
  ctx.lineWidth = Math.max(1, cell * 0.03);
  ctx.beginPath();
  for (let i = 0; i < layout.size; i++) {
    const x = screenXOf(layout, view, i);
    const y = screenYOf(layout, view, i);
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();
}

function drawStars(ctx: CanvasRenderingContext2D, scene: BoardScene, cell: number): void {
  const { layout, view, theme } = scene;
  const radius = Math.max(1.5, cell * 0.09);

  ctx.fillStyle = theme.star;
  for (const point of starPoints(layout.size)) {
    ctx.beginPath();
    ctx.arc(pointX(scene, point), pointY(scene, point), radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Квадратики на пустых пунктах: чья территория по подсчёту движка. */
function drawTerritory(ctx: CanvasRenderingContext2D, scene: BoardScene, cell: number): void {
  const { owners, board, dead } = scene;
  if (!owners) return;
  const side = cell * 0.3;

  for (let point = 0; point < owners.length; point++) {
    const owner = owners[point]!;
    if (owner === EMPTY) continue;
    // Под живым камнем метка не нужна: и так видно, чей он.
    if (board[point] !== EMPTY && !dead.has(point)) continue;

    const x = pointX(scene, point);
    const y = pointY(scene, point);
    ctx.fillStyle = owner === BLACK ? 'rgba(10,10,10,0.75)' : 'rgba(250,250,245,0.85)';
    ctx.fillRect(x - side / 2, y - side / 2, side, side);
  }
}

function drawStones(ctx: CanvasRenderingContext2D, scene: BoardScene, cell: number): void {
  const { board, dead } = scene;
  const radius = cell * 0.47;

  for (let point = 0; point < board.length; point++) {
    const stone = board[point]!;
    if (stone === EMPTY) continue;

    const x = pointX(scene, point);
    const y = pointY(scene, point);
    const isDead = dead.has(point);

    ctx.globalAlpha = isDead ? 0.3 : 1;
    paintStone(ctx, x, y, radius, stone as Color);
    ctx.globalAlpha = 1;

    if (isDead) markDead(ctx, x, y, radius, stone as Color);
  }
}

function paintStone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: Color,
): void {
  // Блик смещён вверх-влево: плоские круги на 19x19 сливаются в кашу.
  const gradient = ctx.createRadialGradient(
    x - radius * 0.35,
    y - radius * 0.35,
    radius * 0.1,
    x,
    y,
    radius,
  );
  if (color === BLACK) {
    gradient.addColorStop(0, '#5a5a5a');
    gradient.addColorStop(1, '#0b0b0b');
  } else {
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#d5d0c2');
  }

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  if (color === WHITE) {
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = Math.max(0.5, radius * 0.06);
    ctx.stroke();
  }
}

function markDead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: Color,
): void {
  const arm = radius * 0.5;
  ctx.strokeStyle = color === BLACK ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.7)';
  ctx.lineWidth = Math.max(1.5, radius * 0.16);
  ctx.beginPath();
  ctx.moveTo(x - arm, y - arm);
  ctx.lineTo(x + arm, y + arm);
  ctx.moveTo(x + arm, y - arm);
  ctx.lineTo(x - arm, y + arm);
  ctx.stroke();
}

function drawLastMove(ctx: CanvasRenderingContext2D, scene: BoardScene, cell: number): void {
  const { board, lastMove } = scene;
  if (lastMove === null) return;

  const stone = board[lastMove];
  if (stone === undefined || stone === EMPTY) return;

  ctx.strokeStyle = stone === BLACK ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)';
  ctx.lineWidth = Math.max(1.5, cell * 0.06);
  ctx.beginPath();
  ctx.arc(pointX(scene, lastMove), pointY(scene, lastMove), cell * 0.2, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Призрачный камень и кольцо вокруг него — результат первого тапа из двух.
 * Кольцо заметно шире камня: сам камень под пальцем не виден.
 */
function drawPending(ctx: CanvasRenderingContext2D, scene: BoardScene, cell: number): void {
  const { theme, pending, pendingColor, rejected } = scene;
  const point = pending ?? rejected;
  if (point === null) return;

  const x = pointX(scene, point);
  const y = pointY(scene, point);

  if (pending !== null) {
    ctx.globalAlpha = 0.55;
    paintStone(ctx, x, y, cell * 0.47, pendingColor);
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = pending !== null ? theme.accent : theme.illegal;
  ctx.lineWidth = Math.max(2, cell * 0.08);
  ctx.beginPath();
  ctx.arc(x, y, cell * 0.82, 0, Math.PI * 2);
  ctx.stroke();
}

function pointX(scene: BoardScene, point: number): number {
  return screenXOf(scene.layout, scene.view, point % scene.layout.size);
}

function pointY(scene: BoardScene, point: number): number {
  return screenYOf(scene.layout, scene.view, (point / scene.layout.size) | 0);
}
