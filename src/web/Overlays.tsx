import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DayView } from '../shared/api';
import { cap, fmtRange, relWord } from './format';
import { allCards } from './Header';
import type { Shown } from './Schedule';

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
  } else {
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

interface PopoverProps {
  b: Shown;
  anchor: HTMLElement;
  day: DayView;
  onCheck: (b: Shown) => void;
  onClose: () => void;
}

export function Popover({ b, anchor, day, onCheck, onClose }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: 0 });

  useLayoutEffect(() => {
    const p = ref.current!;
    const r = anchor.getBoundingClientRect();
    const pw = p.offsetWidth, ph = p.offsetHeight;
    let x = r.right + 10;
    if (x + pw > innerWidth - 10) x = r.left - pw - 10;
    if (x < 10) x = Math.min(innerWidth - pw - 10, r.left + 10);
    const y = Math.min(r.top, innerHeight - ph - 10);
    setPos({ left: Math.max(10, x), top: Math.max(10, y) });
  }, [anchor, b]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', onClose, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="popover" role="dialog" aria-label={b.title} style={pos}>
      <h3>{b.title}</h3>
      {detailLines(b, day).map((l, i) => (
        <div key={i} className="pm">
          {l}
        </div>
      ))}
      {b.checkable && (
        <div className="acts">
          <button
            className="pill primary"
            onClick={() => {
              onClose();
              onCheck(b);
            }}
          >
            {b.done ? 'Mark not done' : 'Mark done'}
          </button>
        </div>
      )}
    </div>
  );
}
