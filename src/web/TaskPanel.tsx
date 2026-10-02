import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { blockLength } from '../core/length';
import type { CategoryView, DailyRow, DayView, StepView, TaskCard } from '../shared/api';
import { catName, catStyle } from './cats';
import { cap, clockMin, deadlineOn, dueLabel, fmtDur, fmtTime, momentOn, relWord } from './format';
import type { BeginDrag } from './drag';
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

export function TaskPanel({ day, categories, filter, showDone, openId, onFilter, onShowDone, onToggleOpen, actions, drag }: Props) {
  const pass = (t: TaskCard) => filter === 'all' || t.categoryId === filter;
  const chips = [{ id: 'all', name: 'All' }, ...categories.filter((c) => c.id !== 'routine')];
  const card = (t: TaskCard) => (
    <Card key={t.id} t={t} day={day} categories={categories} open={openId === t.id} onToggle={() => onToggleOpen(t.id)} actions={actions} begin={drag.begin} />
  );
  const done = day.groups.done.filter(pass);

  return (
    <aside className={`tasks${drag.over ? ' drop-on' : ''}`} aria-label="Tasks" data-drop="tasks">
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
  onToggle: () => void;
  actions: TaskActions;
  begin: BeginDrag;
}

function Card({ t, day, categories, open, onToggle, actions, begin }: CardProps) {
  const decide = t.window === 'decide';
  const overdue = t.effectiveWindow === 'overdue';
  // Waiting and decision items, and finished tasks, don't go on the schedule.
  const canDrag = !decide && t.window !== 'waiting' && !t.doneAt;
  const cls = ['card', t.window === 'waiting' && 'waiting', t.doneAt && 'done', overdue && 'overdue', open && 'open', !canDrag && 'static']
    .filter(Boolean).join(' ');
  const due = deadlineOn(t, day.zone);
  const { when, rest } = detailBits(t, day);
  const cat = catName(categories, t.categoryId);

  return (
    <div
      className={cls}
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
