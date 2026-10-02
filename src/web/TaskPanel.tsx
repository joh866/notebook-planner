import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { blockLength } from '../core/length';
import type { CategoryView, DailyRow, DayView, StepView, TaskCard } from '../shared/api';
import { catName, catStyle } from './cats';
import { cap, clockMin, deadlineOn, dueLabel, fmtDur, fmtTime, momentOn, relWord } from './format';
import type { BeginDrag } from './drag';
import { drawerHeights, nearestStop, tapped, PEEK_PX, type DrawerStop } from './drawer';
import { Check, Del, RepeatIcon } from './icons';

/** What the user can do from the task panel. */
export interface TaskActions {
  checkTask: (id: string, done: boolean) => void;
  checkRoutine: (row: DailyRow) => void;
  deleteTask: (t: TaskCard) => void;
  deleteRoutine: (row: DailyRow) => void;
  decide: (t: TaskCard, yes: boolean) => void;
  answer: (conditionId: string) => void;
  notYet: (conditionId: string) => void;
  pickCategory: (t: TaskCard, el: HTMLElement) => void;
  checkStep: (step: StepView, done: boolean) => void;
  addStep: (taskId: string, title: string) => void;
  removeStep: (step: StepView) => void;
  saveNotes: (taskId: string, notes: string | null) => void;
}

interface Props {
  day: DayView;
  categories: CategoryView[];
  filter: string;
  showDone: boolean;
  /** The expanded card. */
  openId: string | null;
  onFilter: (id: string) => void;
  onShowDone: (show: boolean) => void;
  onToggleOpen: (id: string) => void;
  actions: TaskActions;
  /** `over` is true while something that can come back to the list is dragged over the panel. */
  drag: { begin: BeginDrag; over: boolean };
  /** At phone width the panel is a pull-up drawer (spec §5, "Phone"). */
  drawer?: { stop: DrawerStop; onStop: (s: DrawerStop) => void };
  /** The add box (spec §9, §11). Resolves true when the text was added, which clears the box. */
  onAdd: (text: string) => Promise<boolean>;
  /** Cards just added, which flash briefly. */
  fresh: Set<string>;
}

const GROUPS = [
  ['overdue', 'Overdue'],
  ['near', 'Today or tomorrow'],
  ['week', 'This week'],
  ['soon', 'Soon'],
  ['waiting', 'Waiting on something'],
  ['decide', 'Needs a decision'],
  ['ongoing', 'Ongoing'],
] as const;

/** Group names by window, for messages like "Moved it to Soon." */
export const WINDOW_LABEL: Record<string, string> = Object.fromEntries(GROUPS);

export function TaskPanel({ day, categories, filter, showDone, openId, onFilter, onShowDone, onToggleOpen, actions, drag, drawer, onAdd, fresh }: Props) {
  const pass = (t: TaskCard) => filter === 'all' || t.categoryId === filter;
  const chips = [{ id: 'all', name: 'All' }, ...categories.filter((c) => c.id !== 'routine')];
  const card = (t: TaskCard) => (
    <Card key={t.id} t={t} day={day} categories={categories} open={openId === t.id} fresh={fresh.has(t.id)} onToggle={() => onToggleOpen(t.id)} actions={actions} begin={drag.begin} />
  );
  const done = day.groups.done.filter(pass);

  return (
    <aside className={`tasks${drawer ? ' drawer' : ''}${drag.over ? ' drop-on' : ''}`} aria-label="Tasks" data-drop="tasks">
      {drawer && <DrawerHandle day={day} {...drawer} />}
      <div className="tasks-top">
        <AddBox onAdd={onAdd} />
      </div>
      <div className="tasks-inner">
        <div className="filters">
          {chips.map((c) => (
            <button
              key={c.id}
              aria-pressed={filter === c.id}
              style={c.id === 'all' ? undefined : catStyle(categories, c.id)}
              onClick={() => onFilter(filter === c.id ? 'all' : c.id)}
            >
              {c.id !== 'all' && <i></i>}
              {c.name}
            </button>
          ))}
        </div>

        <Daily rows={day.daily} onCheck={actions.checkRoutine} onDelete={actions.deleteRoutine} begin={drag.begin} />

        {GROUPS.map(([key, label]) => {
          if (key === 'waiting') {
            const groups = day.groups.waiting.map((w) => ({ ...w, tasks: w.tasks.filter(pass) })).filter((w) => w.tasks.length);
            const n = groups.reduce((sum, w) => sum + w.tasks.length, 0);
            if (!n) return null;
            return (
              <div key={key}>
                <GroupHead label={label} count={n} />
                {groups.map((w) => (
                  <div key={w.condition?.id ?? 'none'}>
                    {w.condition && (
                      <div className="cond">
                        <span className="cq">{w.condition.question}</span>
                        {w.ask ? (
                          <>
                            <button className="pill" onClick={() => actions.answer(w.condition!.id)}>Yes</button>
                            <button className="pill" onClick={() => actions.notYet(w.condition!.id)}>Not yet</button>
                          </>
                        ) : (
                          <span className="snz">Asking again tomorrow</span>
                        )}
                      </div>
                    )}
                    {w.tasks.map(card)}
                  </div>
                ))}
              </div>
            );
          }
          const list = day.groups[key].filter(pass);
          if (!list.length) return null;
          return (
            <div key={key}>
              <GroupHead label={label} count={list.length} red={key === 'overdue'} />
              {list.map(card)}
            </div>
          );
        })}

        {done.length > 0 && (
          <div>
            <h2 className="gh">
              <button aria-expanded={showDone} onClick={() => onShowDone(!showDone)}>
                <span>Done</span>
                <span className="count">
                  {done.length}, {showDone ? 'hide' : 'show'}
                </span>
              </button>
            </h2>
            {showDone && done.map(card)}
          </div>
        )}
      </div>
    </aside>
  );
}

/** The panel's height for each drawer stop, measured from the screen and its header. */
function heightsFor(panel: HTMLElement) {
  const screen = panel.closest('.screen')!.getBoundingClientRect();
  const top = panel.closest('.screen')!.querySelector('.top')!.getBoundingClientRect();
  return drawerHeights(screen.height, top.bottom - screen.top);
}

/** Tap to open halfway or close. Drag to resize; it snaps to closed, half, or full. */
function DrawerHandle({ day, stop, onStop }: { day: DayView; stop: DrawerStop; onStop: (s: DrawerStop) => void }) {
  const open = (['overdue', 'near', 'week', 'soon', 'decide', 'ongoing'] as const).reduce((n, k) => n + day.groups[k].length, 0)
    + day.groups.waiting.reduce((n, w) => n + w.tasks.length, 0);

  // Sizes the panel for its stop, and again when the window changes size.
  const ref = useRef<HTMLDivElement>(null);
  const animate = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current?.closest<HTMLElement>('.tasks');
    if (!el) return;
    const apply = (smooth: boolean) => {
      el.style.transition = smooth ? 'height .28s ease' : 'none';
      el.style.height = `${heightsFor(el)[stop]}px`;
    };
    apply(animate.current);
    animate.current = true;
    const resize = () => apply(false);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      // Back to the wide panel's own height if the window widens.
      el.style.transition = '';
      el.style.height = '';
    };
  }, [stop]);

  const down = (e: ReactPointerEvent) => {
    const el = ref.current?.closest<HTMLElement>('.tasks');
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const hs = heightsFor(el);
    const y0 = e.clientY;
    const h0 = el.getBoundingClientRect().height;
    let moved = false;
    el.style.transition = 'none';
    const move = (ev: PointerEvent) => {
      const dy = y0 - ev.clientY;
      if (Math.abs(dy) > 5) moved = true;
      if (moved) el.style.height = `${Math.max(PEEK_PX, Math.min(hs.max, h0 + dy))}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const next = moved ? nearestStop(el.getBoundingClientRect().height, hs) : tapped(stop);
      el.style.transition = 'height .28s ease';
      el.style.height = `${hs[next]}px`;
      onStop(next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    <div
      ref={ref}
      className="handle"
      role="button"
      tabIndex={0}
      aria-expanded={stop !== 'peek'}
      aria-label={stop === 'peek' ? 'Show tasks' : 'Hide tasks'}
      onPointerDown={down}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onStop(tapped(stop));
      }}
    >
      <span className="grab" />
      <span>{open} task{open === 1 ? '' : 's'}</span>
    </div>
  );
}

function GroupHead({ label, count, red }: { label: string; count: number; red?: boolean }) {
  return (
    <h2 className={`gh${red ? ' red' : ''}`}>
      <span>{label}</span>
      <span className="count">{count}</span>
    </h2>
  );
}

interface DailyProps {
  rows: DailyRow[];
  onCheck: (row: DailyRow) => void;
  onDelete: (row: DailyRow) => void;
  begin: BeginDrag;
}

function Daily({ rows, onCheck, onDelete, begin }: DailyProps) {
  if (!rows.length) return null;
  return (
    <div>
      <h2 className="gh">
        <span>Daily</span>
        <span className="count">
          {rows.filter((r) => r.checked).length} of {rows.length}
        </span>
      </h2>
      {rows.map((r) => (
        <div
          key={r.routineId}
          className={`check-row${r.checked ? ' done' : ''}`}
          onPointerDown={(e) => begin(e, { type: 'routine', routineId: r.routineId, title: r.title, minutes: r.durationMinutes }, e.currentTarget)}
        >
          <Check checked={r.checked} label={r.title} onToggle={() => onCheck(r)} />
          <span className="t">{r.title}</span>
          <span className="r">
            {r.streak ? <span>{r.streak}-day streak</span> : null}
            {r.time && (
              <span>
                <RepeatIcon />
                {fmtTime(clockMin(r.time))}
              </span>
            )}
            {r.skipped && <span>Skipped today</span>}
          </span>
          <Del trash label={`Delete routine: ${r.title}`} onClick={() => onDelete(r)} />
        </div>
      ))}
    </div>
  );
}

const TONE = { plain: '', soon: 'soon', urgent: 'urgent', overdue: 'over' } as const;

/** The detail line: when it's scheduled, or the estimate, plus step progress (spec §9). */
function detailBits(t: TaskCard, day: DayView): { when: string | null; rest: string[] } {
  let when: string | null = null;
  const rest: string[] = [];
  if (t.scheduled && !t.doneAt) {
    if ('startAt' in t.scheduled) {
      const at = momentOn(t.scheduled.startAt, day.zone);
      when = `${cap(relWord(day.today, at.date))} ${fmtTime(at.min)}`;
    } else {
      when = `Sometime ${relWord(day.today, t.scheduled.sometime)}`;
    }
  } else if (t.sessionMinutes) {
    rest.push(`${fmtDur(t.sessionMinutes)} sessions`);
  } else if (t.estLow != null) {
    rest.push(`About ${fmtDur(t.estLow, t.estHigh)}`);
  }
  if (t.steps.length) rest.push(`${t.steps.filter((s) => s.done).length} of ${t.steps.length} steps`);
  if (t.notes) rest.push('Has notes');
  return { when, rest };
}

/** Clicks on buttons and fields inside a card don't open or close it. */
const fromControl = (e: MouseEvent | KeyboardEvent) => !!(e.target as HTMLElement).closest('button, input, textarea, a');

interface CardProps {
  t: TaskCard;
  day: DayView;
  categories: CategoryView[];
  open: boolean;
  fresh: boolean;
  onToggle: () => void;
  actions: TaskActions;
  begin: BeginDrag;
}

/**
 * One text box that grows as you type and takes a whole pasted list. Enter adds, Shift+Enter is a
 * new line, and it says "Sorting…" while the AI works.
 */
function AddBox({ onAdd }: { onAdd: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(180, Math.ceil(el.scrollHeight))}px`;
    el.style.overflowY = el.scrollHeight > 180 ? 'auto' : 'hidden';
  }, [text]);

  // The box is disabled while sorting, so focus comes back afterward, ready for the next thing.
  const refocus = useRef(false);
  useEffect(() => {
    if (busy || !refocus.current) return;
    refocus.current = false;
    ref.current?.focus({ preventScroll: true });
  }, [busy]);

  const submit = async () => {
    const v = text.trim();
    if (!v || busy) return;
    refocus.current = document.activeElement === ref.current;
    setBusy(true);
    try {
      if (await onAdd(v)) setText('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`quickadd${busy ? ' is-busy' : ''}`}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
      <textarea
        ref={ref}
        rows={1}
        value={text}
        disabled={busy}
        placeholder="Add anything, or paste a whole list"
        aria-label="Add something"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {busy && <span className="busy" role="status">Sorting…</span>}
    </div>
  );
}

function Card({ t, day, categories, open, fresh, onToggle, actions, begin }: CardProps) {
  const decide = t.window === 'decide';
  const overdue = t.effectiveWindow === 'overdue';
  // Waiting and decision items, and finished tasks, don't go on the schedule.
  const canDrag = !decide && t.window !== 'waiting' && !t.doneAt;
  const cls = ['card', t.window === 'waiting' && 'waiting', t.doneAt && 'done', overdue && 'overdue', open && 'open', !canDrag && 'static', fresh && 'fresh']
    .filter(Boolean).join(' ');
  const due = deadlineOn(t, day.zone);
  const { when, rest } = detailBits(t, day);
  const cat = catName(categories, t.categoryId);

  return (
    <div
      className={cls}
      data-id={t.id}
      style={catStyle(categories, t.categoryId)}
      tabIndex={0}
      aria-expanded={open}
      aria-label={`${t.title}. ${open ? 'Hide' : 'Show'} steps and notes`}
      onClick={(e) => !fromControl(e) && onToggle()}
      onPointerDown={(e) => canDrag && begin(e, { type: 'task', taskId: t.id, title: t.title, minutes: blockLength(t) }, e.currentTarget)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {decide ? <span className="q" aria-hidden="true">?</span> : <Check checked={!!t.doneAt} label={t.title} onToggle={() => actions.checkTask(t.id, !t.doneAt)} />}
      <div>
        <div className="t">
          <button className="catdot" title={cat} aria-label={`Category: ${cat}. Change it`} onClick={(e) => actions.pickCategory(t, e.currentTarget)} />
          {t.title}
        </div>
        {t.meta && <div className="m">{t.meta}</div>}
        {(when || rest.length > 0) && (
          <div className="e">
            {when && <span className="when">{when}</span>}
            {when && rest.length > 0 && '. '}
            {rest.join('. ')}
          </div>
        )}
      </div>
      {decide ? (
        <div className="decide">
          <button onClick={() => actions.decide(t, true)}>Yes</button>
          <button onClick={() => actions.decide(t, false)}>No</button>
        </div>
      ) : (
        due && t.dueTone && (
          <span className={`due ${t.doneAt ? '' : TONE[t.dueTone]}`}>
            {overdue ? 'Was due' : 'Due'} {dueLabel(day.today, due.date, due.min)}
          </span>
        )
      )}
      {open && <Details t={t} actions={actions} />}
      <Del trash className="trash" label={`Delete task: ${t.title}`} onClick={() => actions.deleteTask(t)} />
    </div>
  );
}

/** The expanded card: a steps checklist and notes (spec §9). */
function Details({ t, actions }: { t: TaskCard; actions: TaskActions }) {
  const [step, setStep] = useState('');
  const [notes, setNotes] = useState(t.notes ?? '');
  const saveNotes = () => {
    const v = notes.trim() ? notes : null;
    if (v !== (t.notes ?? null)) actions.saveNotes(t.id, v);
  };
  return (
    <div className="details">
      <div className="lab">Steps</div>
      <div className="steps">
        {t.steps.map((s) => (
          <div key={s.id} className={`step${s.done ? ' done' : ''}`}>
            <Check checked={s.done} label={s.title} onToggle={() => actions.checkStep(s, !s.done)} />
            <span>{s.title}</span>
            <Del label={`Remove step: ${s.title}`} onClick={() => actions.removeStep(s)} />
          </div>
        ))}
      </div>
      <input
        className="addstep"
        value={step}
        placeholder="Add a step and press Enter"
        aria-label={`Add a step to ${t.title}`}
        onChange={(e) => setStep(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const v = step.trim();
          if (!v) return;
          actions.addStep(t.id, v);
          setStep('');
        }}
      />
      <div className="lab">Notes</div>
      <textarea
        className="notes"
        value={notes}
        placeholder="Links, materials, anything else"
        aria-label={`Notes for ${t.title}`}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={saveNotes}
      />
    </div>
  );
}
