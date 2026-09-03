import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FIT_VIEW,
  clampView,
  layoutFor,
  pinchView,
  pointAt,
  type BoardLayout,
  type View,
} from './geometry.js';
import { drawBoard, themeFor, type BoardScene } from './render.js';

/** Сдвиг в CSS-пикселях, после которого тап превращается в панораму. */
const TAP_SLOP = 8;

type SceneInput = Omit<BoardScene, 'layout' | 'view' | 'theme'>;

export interface BoardProps extends SceneInput {
  size: number;
  dark: boolean;
  onTapPoint: (point: number) => void;
  /** Тап мимо пересечений — экран снимает намеченный ход. */
  onTapOutside?: () => void;
}

interface Pointer {
  x: number;
  y: number;
}

export function Board(props: BoardProps) {
  const { size, dark, onTapPoint, onTapOutside } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<BoardLayout | null>(null);
  const viewRef = useRef<View>(FIT_VIEW);
  const sceneRef = useRef<SceneInput>(props);
  const frameRef = useRef(0);

  const pointersRef = useRef(new Map<number, Pointer>());
  const gestureRef = useRef<{
    mode: 'tap' | 'pan' | 'pinch';
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    pinchStartView: View;
    pinchStartDistance: number;
    pinchStartFocalX: number;
    pinchStartFocalY: number;
  } | null>(null);

  // Только для показа кнопки сброса: сам зум живёт в ref, чтобы панорама
  // не гоняла React-рендер на каждом кадре жеста.
  const [zoomed, setZoomed] = useState(false);

  const paint = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    if (!canvas || !layout) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawBoard(ctx, {
      ...sceneRef.current,
      layout,
      view: viewRef.current,
      theme: themeFor(dark),
    });
  }, [dark]);

  const schedule = useCallback(() => {
    if (frameRef.current === 0) frameRef.current = requestAnimationFrame(paint);
  }, [paint]);

  useEffect(() => {
    sceneRef.current = props;
    schedule();
  });

  // Размер канвы задаёт ResizeObserver: в WebView высота вьюпорта меняется
  // при появлении клавиатуры и на повороте, а 100vh про это не знает.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const resize = () => {
      const { width, height } = wrap.getBoundingClientRect();
      if (width === 0 || height === 0) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

      const layout = layoutFor(size, width, height);
      layoutRef.current = layout;
      viewRef.current = clampView(layout, viewRef.current);
      schedule();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [size, schedule]);

  // Смена размера доски — это другая партия, прежний зум к ней неприменим.
  useEffect(() => {
    viewRef.current = FIT_VIEW;
    setZoomed(false);
    const layout = layoutRef.current;
    if (layout) layoutRef.current = layoutFor(size, layout.width, layout.height);
    schedule();
  }, [size, schedule]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      // Обнулять обязательно: иначе следующий schedule() решит, что кадр уже
      // заказан, и не закажет новый. В dev StrictMode монтирует компонент
      // дважды, и без этого доска не рисовалась ни разу.
      frameRef.current = 0;
    },
    [],
  );

  const localPoint = (event: React.PointerEvent<HTMLCanvasElement>): Pointer => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localPoint(event);
    const pointers = pointersRef.current;
    pointers.set(event.pointerId, point);

    if (pointers.size === 1) {
      gestureRef.current = {
        mode: 'tap',
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        pinchStartView: viewRef.current,
        pinchStartDistance: 0,
        pinchStartFocalX: 0,
        pinchStartFocalY: 0,
      };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gestureRef.current = {
        mode: 'pinch',
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        pinchStartView: viewRef.current,
        pinchStartDistance: distance(a!, b!),
        pinchStartFocalX: (a!.x + b!.x) / 2,
        pinchStartFocalY: (a!.y + b!.y) / 2,
      };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) return;

    const point = localPoint(event);
    pointers.set(event.pointerId, point);

    const gesture = gestureRef.current;
    const layout = layoutRef.current;
    if (!gesture || !layout) return;

    if (gesture.mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const spread = distance(a!, b!);
      if (gesture.pinchStartDistance > 0) {
        viewRef.current = pinchView(
          layout,
          gesture.pinchStartView,
          gesture.pinchStartFocalX,
          gesture.pinchStartFocalY,
          (a!.x + b!.x) / 2,
          (a!.y + b!.y) / 2,
          spread / gesture.pinchStartDistance,
        );
        schedule();
      }
      return;
    }

    if (pointers.size !== 1) return;

    if (gesture.mode === 'tap') {
      const moved = Math.hypot(point.x - gesture.startX, point.y - gesture.startY);
      if (moved <= TAP_SLOP) return;
      gesture.mode = 'pan';
    }

    viewRef.current = clampView(layout, {
      scale: viewRef.current.scale,
      panX: viewRef.current.panX + (point.x - gesture.lastX),
      panY: viewRef.current.panY + (point.y - gesture.lastY),
    });
    gesture.lastX = point.x;
    gesture.lastY = point.y;
    schedule();
  };

  const endPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const pointers = pointersRef.current;
    const point = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const gesture = gestureRef.current;
    const layout = layoutRef.current;
    if (!gesture || !layout) return;

    if (gesture.mode === 'tap' && point && pointers.size === 0) {
      const target = pointAt(layout, viewRef.current, point.x, point.y);
      if (target === null) onTapOutside?.();
      else onTapPoint(target);
    }

    if (pointers.size === 0) {
      gestureRef.current = null;
      setZoomed(viewRef.current.scale > 1.01);
      return;
    }

    // Убрали один палец из двух — продолжаем как панораму оставшимся.
    const [remaining] = [...pointers.values()];
    gestureRef.current = {
      ...gesture,
      mode: 'pan',
      lastX: remaining!.x,
      lastY: remaining!.y,
    };
  };

  const resetZoom = () => {
    const layout = layoutRef.current;
    viewRef.current = layout ? clampView(layout, FIT_VIEW) : FIT_VIEW;
    setZoomed(false);
    schedule();
  };

  return (
    <div ref={wrapRef} className="board-wrap">
      <canvas
        ref={canvasRef}
        className="board-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      />
      {zoomed && (
        <button type="button" className="board-reset" onClick={resetZoom}>
          Вся доска
        </button>
      )}
    </div>
  );
}

function distance(a: Pointer, b: Pointer): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
