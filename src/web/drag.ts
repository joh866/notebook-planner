import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { dropStart, minuteAt, resizedLength, type Segment } from '../core/timeline';
import type { Shown } from './Schedule';

// Drag and drop with the mouse or touch (spec §5, §10), ported from the prototype's pointer code.
// Mouse drags start after 5px of movement. Touch drags start after a 280ms press and hold; moving
// before that scrolls the page instead. The web app only works out where a drop would land; the
// server makes the change.

export type DragItem =
  /** A task card, or a task inside a "Quick things" block (`fromBatch`). Quick ones can join a batch. */
  | { type: 'task'; taskId: string; title: string; minutes: number; quick?: boolean; fromBatch?: string }
  | { type: 'sometime'; taskId: string; title: string; minutes: number }
  /** A Daily checklist row. */
  | { type: 'routine'; routineId: string; title: string; minutes: number }
  | { type: 'block'; b: Shown; title: string; minutes: number }
  /** A block's bottom edge. */
  | { type: 'resize'; b: Shown; title: string; minutes: number };

export type DropZone = 'grid' | 'sometime' | 'tasks' | 'batch';

export type DropTarget =
  | { kind: 'grid'; startMin: number }
  | { kind: 'sometime' }
  /** Onto a "Quick things" block, which the task joins (spec §10). */
  | { kind: 'batch'; blockId: string }
  | { kind: 'tasks' }
  | { kind: 'resize'; minutes: number };

/** Where the drag is now, for drawing the ghost, the highlighted drop zone, and a resize. */
export interface DragView {
  item: DragItem;
  target: DropTarget | null;
}

/** What the schedule's drop math needs: its stretches, and now when the day is today. */
export interface Geometry {
  segs: Segment[];
  nowMin: number | null;
}

/** Classes, skipped classes, and open time stay put. Everything else on the schedule moves and resizes. */
export const movable = (b: Shown) => b.look !== 'class' && b.look !== 'skipped' && b.look !== 'open';

const isTaskBlock = (b: Shown) => b.item.type === 'block' && b.item.kind === 'task';

/** Which drop zones take which items (spec §10, "Drag and drop"). */
export function accepts(item: DragItem, zone: DropZone): boolean {
  if (item.type === 'resize') return false;
  if (zone === 'grid') return item.type !== 'block' || movable(item.b);
  if (zone === 'sometime') return item.type === 'task' || (item.type === 'block' && isTaskBlock(item.b));
  if (zone === 'batch') return item.type === 'task' && !!item.quick;
  return item.type === 'sometime' || (item.type === 'task' && !!item.fromBatch) || (item.type === 'block' && movable(item.b));
}

const HOLD_MS = 280;
const MOUSE_START_PX = 5;
const TOUCH_SLOP_PX = 10;
/** Hovering over a folded strip this long opens it. */
const STRIP_OPEN_MS = 350;
/** Dragging this close to the top or bottom of the scrolling area scrolls it. */
const EDGE_PX = 56;

export interface DragOptions {
  geometry: () => Geometry | null;
  onStart: (item: DragItem) => void;
  /** After every started drag, dropped or not. */
  onEnd: () => void;
  onDrop: (item: DragItem, target: DropTarget) => void;
  onOpenStrip: (id: 'early' | 'late') => void;
}

export type BeginDrag = (e: ReactPointerEvent, item: DragItem, el: HTMLElement) => void;

interface Session {
  item: DragItem;
  el: HTMLElement;
  x0: number;
  y0: number;
  x: number;
  y: number;
  started: boolean;
  touch: boolean;
  /** Where in the block it was grabbed, so the block doesn't jump. */
  offY: number;
  target: DropTarget | null;
  strip: string | null;
  holdTimer?: ReturnType<typeof setTimeout>;
  stripTimer?: ReturnType<typeof setTimeout>;
  raf?: number;
  clone?: HTMLElement;
}

const sameTarget = (a: DropTarget | null, b: DropTarget | null) => JSON.stringify(a) === JSON.stringify(b);

/** After a drag, the click the browser sends on release shouldn't open a popover or a card. */
function swallowNextClick() {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', stop, true);
  setTimeout(() => window.removeEventListener('click', stop, true), 0);
}

/**
 * What scrolls during a drag: the page on wide screens, or the content area on the phone, where
 * the bottom stops at the task drawer.
 */
function scrollArea(): { el: Element; top: number; bottom: number } {
  const main = document.querySelector('.main');
  if (main && getComputedStyle(main).overflowY !== 'visible') {
    const r = main.getBoundingClientRect();
    const drawer = document.querySelector('.tasks.drawer');
    return { el: main, top: r.top, bottom: drawer ? Math.min(r.bottom, drawer.getBoundingClientRect().top) : r.bottom };
  }
  return { el: document.scrollingElement ?? document.documentElement, top: 0, bottom: window.innerHeight };
}

class DragController {
  s: Session | null = null;
  private options: DragOptions | null = null;

  constructor(private show: (v: DragView | null) => void) {}

  private opts(): DragOptions {
    return this.options!;
  }

  /** Called after each render with the latest callbacks. Opening a strip moves things, so the drop is worked out again. */
  setOptions(o: DragOptions) {
    this.options = o;
    this.update();
  }

  begin: BeginDrag = (e, item, el) => {
    if (e.button !== 0 || this.s) return;
    if (item.type !== 'resize' && (e.target as HTMLElement).closest('button, input, textarea, a, .details')) return;
    const rect = el.getBoundingClientRect();
    const s: Session = {
      item, el, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false,
      touch: e.pointerType !== 'mouse', offY: item.type === 'block' ? Math.min(e.clientY - rect.top, 24) : 12,
      target: null, strip: null,
    };
    this.s = s;
    if (s.touch) {
      s.holdTimer = setTimeout(() => {
        if (this.s !== s || s.started) return;
        navigator.vibrate?.(12);
        this.start();
      }, HOLD_MS);
    }
    window.addEventListener('pointermove', this.move, { passive: false });
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.cancel);
    window.addEventListener('keydown', this.key);
  };

  private move = (e: PointerEvent) => {
    const s = this.s;
    if (!s) return;
    s.x = e.clientX;
    s.y = e.clientY;
    if (!s.started) {
      const dist = Math.hypot(s.x - s.x0, s.y - s.y0);
      // On touch, moving before the hold ends is a scroll, not a drag.
      if (s.touch) {
        if (dist > TOUCH_SLOP_PX) this.cancel();
        return;
      }
      if (dist < MOUSE_START_PX) return;
      this.start();
    }
    e.preventDefault();
    this.update();
  };

  private start() {
    const s = this.s!;
    s.started = true;
    this.opts().onStart(s.item);
    document.body.classList.add('is-dragging');
    if (s.item.type !== 'resize') {
      s.el.classList.add('dragging');
      const c = document.createElement('div');
      c.className = 'drag-clone';
      c.textContent = s.item.title;
      document.body.appendChild(c);
      s.clone = c;
    }
    this.show({ item: s.item, target: null });
    s.raf = requestAnimationFrame(this.scroll);
    this.update();
  }

  /** Works out the drop under the pointer. */
  private update() {
    const s = this.s;
    if (!s?.started) return;
    const geo = this.opts().geometry();
    const grid = document.querySelector<HTMLElement>('[data-drop="grid"]');
    const gridMinute = (offY: number) => (geo && grid ? minuteAt(geo.segs, s.y - grid.getBoundingClientRect().top - offY) : null);

    if (s.item.type === 'resize') {
      const end = gridMinute(0);
      return this.target(end == null ? null : { kind: 'resize', minutes: resizedLength(s.item.b.startMin, end) });
    }

    if (s.clone) {
      s.clone.style.left = `${s.x + 14}px`;
      s.clone.style.top = `${s.y - 16}px`;
    }
    const under = document.elementFromPoint(s.x, s.y) as HTMLElement | null;
    const strip = under?.closest<HTMLElement>('[data-strip]')?.dataset.strip;
    if (strip === 'early' || strip === 'late') {
      if (s.strip !== strip) {
        s.strip = strip;
        clearTimeout(s.stripTimer);
        s.stripTimer = setTimeout(() => {
          if (this.s === s) this.opts().onOpenStrip(strip);
        }, STRIP_OPEN_MS);
      }
      return this.target(null);
    }
    s.strip = null;
    clearTimeout(s.stripTimer);

    let zoneEl = under?.closest<HTMLElement>('[data-drop]');
    // A "Quick things" block takes quick tasks. Anything else dropped on it goes on the schedule there.
    if (zoneEl?.dataset.drop === 'batch' && (!accepts(s.item, 'batch') || (s.item.type === 'task' && s.item.fromBatch === zoneEl.dataset.block))) {
      zoneEl = zoneEl.parentElement?.closest<HTMLElement>('[data-drop]');
    }
    const zone = zoneEl?.dataset.drop as DropZone | undefined;
    if (!zone || !accepts(s.item, zone)) return this.target(null);
    if (zone === 'batch') return this.target({ kind: 'batch', blockId: zoneEl!.dataset.block! });
    if (zone === 'grid') {
      const m = gridMinute(s.offY);
      const startMin = m == null || !geo ? null : dropStart(geo.segs, m, s.item.minutes, geo.nowMin);
      return this.target(startMin == null ? null : { kind: 'grid', startMin });
    }
    this.target({ kind: zone });
  }

  private target(t: DropTarget | null) {
    const s = this.s!;
    if (sameTarget(s.target, t)) return;
    s.target = t;
    this.show({ item: s.item, target: t });
  }

  private scroll = () => {
    const s = this.s;
    if (!s?.started) return;
    const { el: sc, top, bottom } = scrollArea();
    let dy = 0;
    if (s.y < top + EDGE_PX && s.y > top - 40) dy = -Math.ceil((top + EDGE_PX - s.y) / 5);
    else if (s.y > bottom - EDGE_PX && s.y < bottom + 40) dy = Math.ceil((s.y - (bottom - EDGE_PX)) / 5);
    if (dy) {
      sc.scrollTop += dy;
      this.update();
    }
    s.raf = requestAnimationFrame(this.scroll);
  };

  private up = () => {
    const s = this.s;
    if (!s) return;
    const { started, target, item } = s;
    this.finish();
    if (!started) return;
    swallowNextClick();
    if (target) this.opts().onDrop(item, target);
  };

  cancel = () => {
    if (this.s) this.finish();
  };

  private key = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.s?.started) {
      e.preventDefault();
      this.cancel();
    }
  };

  private finish() {
    const s = this.s!;
    clearTimeout(s.holdTimer);
    clearTimeout(s.stripTimer);
    if (s.raf) cancelAnimationFrame(s.raf);
    s.clone?.remove();
    s.el.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointercancel', this.cancel);
    window.removeEventListener('keydown', this.key);
    this.s = null;
    if (s.started) {
      this.show(null);
      this.opts().onEnd();
    }
  }
}

/** The drag controller for the page, and what it's dragging now. */
export function useDrag(options: DragOptions): { begin: BeginDrag; view: DragView | null } {
  const [view, setView] = useState<DragView | null>(null);
  const [ctl] = useState(() => new DragController(setView));

  useEffect(() => {
    ctl.setOptions(options);
  });

  useEffect(() => {
    // Once a touch drag starts, the page shouldn't scroll under the finger, and a long press
    // shouldn't open the browser's menu.
    const touchmove = (e: TouchEvent) => {
      if (ctl.s?.started) e.preventDefault();
    };
    const menu = (e: Event) => {
      if (ctl.s?.touch) e.preventDefault();
    };
    document.addEventListener('touchmove', touchmove, { passive: false });
    document.addEventListener('contextmenu', menu);
    return () => {
      document.removeEventListener('touchmove', touchmove);
      document.removeEventListener('contextmenu', menu);
      ctl.cancel();
    };
  }, [ctl]);

  return { begin: ctl.begin, view };
}
