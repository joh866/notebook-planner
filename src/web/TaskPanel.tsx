import type { CategoryView, DailyRow, DayView, TaskCard } from '../shared/api';
import { catName, catStyle } from './cats';
import { cap, clockMin, deadlineOn, dueLabel, fmtDur, fmtTime, momentOn, relWord } from './format';
import { Check, RepeatIcon } from './icons';

interface Props {
  day: DayView;
  categories: CategoryView[];
  filter: string;
  showDone: boolean;
  onFilter: (id: string) => void;
  onShowDone: (show: boolean) => void;
  onCheckTask: (id: string, done: boolean) => void;
  onCheckRoutine: (row: DailyRow) => void;
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

export function TaskPanel({ day, categories, filter, showDone, onFilter, onShowDone, onCheckTask, onCheckRoutine }: Props) {
  const pass = (t: TaskCard) => filter === 'all' || t.categoryId === filter;
  const chips = [{ id: 'all', name: 'All' }, ...categories.filter((c) => c.id !== 'routine')];
  const card = (t: TaskCard) => <Card key={t.id} t={t} day={day} categories={categories} onCheck={onCheckTask} />;
  const done = day.groups.done.filter(pass);

  return (
    <aside className="tasks" aria-label="Tasks">
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

        <Daily rows={day.daily} onCheck={onCheckRoutine} />

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
                        {!w.ask && <span className="snz">Asking again tomorrow</span>}
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

function Daily({ rows, onCheck }: { rows: DailyRow[]; onCheck: (row: DailyRow) => void }) {
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
        <div key={r.routineId} className={`check-row${r.checked ? ' done' : ''}`}>
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
          </span>
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

function Card({ t, day, categories, onCheck }: { t: TaskCard; day: DayView; categories: CategoryView[]; onCheck: (id: string, done: boolean) => void }) {
  const decide = t.window === 'decide';
  const overdue = t.effectiveWindow === 'overdue';
  const cls = ['card', t.window === 'waiting' && 'waiting', t.doneAt && 'done', overdue && 'overdue'].filter(Boolean).join(' ');
  const due = deadlineOn(t, day.zone);
  const { when, rest } = detailBits(t, day);

  return (
    <div className={cls} style={catStyle(categories, t.categoryId)}>
      {decide ? <span className="q" aria-hidden="true">?</span> : <Check checked={!!t.doneAt} label={t.title} onToggle={() => onCheck(t.id, !t.doneAt)} />}
      <div>
        <div className="t">
          <span className="catdot" title={catName(categories, t.categoryId)} aria-label={`Category: ${catName(categories, t.categoryId)}`} />
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
      {due && t.dueTone && (
        <span className={`due ${t.doneAt ? '' : TONE[t.dueTone]}`}>
          {overdue ? 'Was due' : 'Due'} {dueLabel(day.today, due.date, due.min)}
        </span>
      )}
    </div>
  );
}
