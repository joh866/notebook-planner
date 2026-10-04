import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CategoryView, DayView } from '../shared/api';
import { catStyle, findCategory } from './cats';
import { cap, fmtRange, relWord } from './format';
import { allCards } from './Header';
import { removeLabel, type Shown } from './Schedule';

export interface ToastState {
  id: number;
  message: string;
  actions?: { label: string; run: () => void }[];
  ms?: number;
}

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(onClose, toast.ms ?? 4500);
    return () => clearTimeout(id);
  }, [toast, onClose]);
  if (!toast) return null;
  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      {toast.actions?.map((a) => (
        <button
          key={a.label}
          onClick={() => {
            onClose();
            a.run();
          }}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** What a block's details popover says (spec §7, "Tap for details"). */
export function detailLines(b: Shown, day: DayView): string[] {
  const lines = [`${cap(relWord(day.today, day.date))}, ${fmtRange(b.startMin, b.endMin)}`];
  const item = b.item;
  if (item.type === 'class') {
    if (item.fullName) lines.push(item.fullName);
    if (item.location) lines.push(item.location);
    if (item.skipped) lines.push('Skipping this one');
  } else if (item.type === 'routine') {
    if (item.changed) lines.push('Moved for this day only');
    for (const p of b.parts) lines.push(`${p.title}, ${p.endMin - p.startMin}m${p.waiting ? ', waiting' : ''}`);
  } else if (item.type === 'google') {
    if (item.location) lines.push(item.location);
    lines.push(`From Google Calendar (${item.calendar}). Change it there.`);
    if (!item.busy) lines.push('Marked free, so the planner can put things here.');
  } else {
    if (b.cond) lines.push(cap(b.cond));
    for (const x of item.items) lines.push(`${x.done ? '✓ ' : ''}${x.title}, ${x.minutes}m`);
    if (item.location) lines.push(item.location);
    if (item.tentative && item.label) lines.push(item.label);
    if (item.kind === 'task') {
      const card = allCards(day.groups).find((x) => x.id === item.taskId);
      if (card?.meta) lines.push(card.meta);
      if (item.nextStep) lines.push(`Next: ${item.nextStep}`);
      if (item.pinned) lines.push('Pinned by you, so the planner won’t move it.');
      else lines.push(`Penciled in by the planner${item.reason ? `: ${item.reason.charAt(0).toLowerCase()}${item.reason.slice(1)}` : ''}. It may move this if plans change.`);
    }
  }
  return lines;
}

/** Keeps a floating panel next to its anchor and closes it on an outside press, Escape, or scroll. */
function useFloating(anchor: HTMLElement, place: 'side' | 'below', onClose: () => void, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: 0 });

  useLayoutEffect(() => {
    const p = ref.current!;
    const r = anchor.getBoundingClientRect();
    const pw = p.offsetWidth, ph = p.offsetHeight;
    let x: number, y: number;
    if (place === 'side') {
      x = r.right + 10;
      if (x + pw > innerWidth - 10) x = r.left - pw - 10;
      if (x < 10) x = Math.min(innerWidth - pw - 10, r.left + 10);
      y = Math.min(r.top, innerHeight - ph - 10);
    } else {
      x = Math.min(r.left, innerWidth - pw - 10);
      y = r.bottom + 8 + ph < innerHeight - 10 ? r.bottom + 8 : r.top - ph - 8;
    }
    setPos({ left: Math.max(10, x), top: Math.max(10, y) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, place, ...deps]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    // Capture, so scrolling the phone's content area or the drawer counts too.
    window.addEventListener('scroll', onClose, { passive: true, capture: true });
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', onClose, { capture: true });
    };
  }, [onClose]);

  return { ref, pos };
}

interface PopoverProps {
  b: Shown;
  anchor: HTMLElement;
  day: DayView;
  onCheck: (b: Shown) => void;
  onRemove: (b: Shown) => void;
  onPin: (b: Shown) => void;
  onStillOn: (b: Shown, yes: boolean) => void;
  onStart: (taskId: string, title: string) => void;
  onStop: (taskId: string, done: boolean) => void;
  onEditClass: (classId: string) => void;
  onClose: () => void;
}

/** A block's details and actions: Done, Skip, Pin or Unpin, Back to the list, Edit, and "Still on?" (spec §7). */
export function Popover({ b, anchor, day, onCheck, onRemove, onPin, onStillOn, onStart, onStop, onEditClass, onClose }: PopoverProps) {
  const { ref, pos } = useFloating(anchor, 'side', onClose, [b]);
  const item = b.item;
  const acts: { label: string; run: () => void; primary?: boolean }[] = [];
  if (b.checkable) acts.push({ label: b.done ? 'Mark not done' : 'Mark done', run: () => onCheck(b), primary: true });
  if (item.type === 'block' && item.kind === 'task' && item.taskId && !b.done) {
    // Start and Stop (spec §10, "Actual time").
    const taskId = item.taskId;
    if (item.running) {
      acts.push({ label: 'Stop', run: () => onStop(taskId, false) });
      acts.push({ label: 'Done', run: () => onStop(taskId, true), primary: true });
    } else {
      acts.push({ label: 'Start', run: () => onStart(taskId, b.title) });
    }
  }
  if (item.type === 'block' && item.kind === 'task') acts.push({ label: item.pinned ? 'Unpin' : 'Pin here', run: () => onPin(b) });
  if (item.type !== 'google') acts.push({ label: removeLabel(b), run: () => onRemove(b) });
  else if (item.link) {
    const link = item.link;
    acts.push({ label: 'Open in Google', run: () => window.open(link, '_blank', 'noopener') });
  }
  if (item.type === 'class') acts.push({ label: 'Edit', run: () => onEditClass(item.classId) });

  return (
    <div ref={ref} className="popover" role="dialog" aria-label={b.title} style={pos}>
      <h3>{b.title}</h3>
      {detailLines(b, day).map((l, i) => (
        <div key={i} className="pm">
          {l}
        </div>
      ))}
      {b.askNow && (
        <div className="acts">
          <span className="pm">Still on?</span>
          <button className="pill primary" onClick={() => { onClose(); onStillOn(b, true); }}>Yes</button>
          <button className="pill" onClick={() => { onClose(); onStillOn(b, false); }}>No</button>
        </div>
      )}
      <div className="acts">
        {acts.map((a) => (
          <button
            key={a.label}
            className={`pill${a.primary ? ' primary' : ''}`}
            onClick={() => {
              onClose();
              a.run();
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface CatPickerProps {
  anchor: HTMLElement;
  current: string | null;
  categories: CategoryView[];
  onPick: (id: string) => void;
  /** A typed name that isn't a category yet. */
  onNew: (name: string) => void;
  onClose: () => void;
}

/** Pick a category for a task, or type a new one (spec §9, §11 "Manual category change"). */
export function CatPicker({ anchor, current, categories, onPick, onNew, onClose }: CatPickerProps) {
  const { ref, pos } = useFloating(anchor, 'below', onClose, []);
  const [text, setText] = useState('');
  const choices = categories.filter((c) => c.id !== 'routine');
  return (
    <div ref={ref} className="popover" role="dialog" aria-label="Choose a category" style={pos}>
      <h3>Category</h3>
      <div className="catpick">
        {choices.map((c) => (
          <button
            key={c.id}
            aria-pressed={current === c.id}
            style={catStyle(categories, c.id)}
            onClick={() => {
              onClose();
              if (c.id !== current) onPick(c.id);
            }}
          >
            <i></i>
            {c.name}
          </button>
        ))}
        <input
          value={text}
          placeholder="New category, then Enter"
          aria-label="New category"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (!text.trim().replace(/^#/, '')) return;
            onClose();
            const found = findCategory(categories, text);
            if (found) {
              if (found.id !== current) onPick(found.id);
            } else onNew(text);
          }}
        />
      </div>
    </div>
  );
}
