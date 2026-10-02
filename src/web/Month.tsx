import { weekday } from '../core/day';
import type { CategoryView, MonthView } from '../shared/api';
import { dueText } from './agenda';
import { classTitle } from './ClassDialog';
import { catStyle } from './cats';
import { dayButton } from './dayButton';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  month: MonthView;
  categories: CategoryView[];
  onOpenDay: (date: string) => void;
}

/** The month grid: each day lists its deadlines, events, and weekly chores (spec §8, "Month"). */
export function Month({ month, categories, onOpenDay }: Props) {
  const ws = month.weekStart;
  const first = month.days[0]!.date;
  const blanks = (weekday(first) - ws + 7) % 7;
  return (
    <section className="month-grid" aria-label="Month">
      {Array.from({ length: 7 }, (_, k) => (
        <div key={`h${k}`} className="mo-head">{SHORT_DAYS[(ws + k) % 7]}</div>
      ))}
      {Array.from({ length: blanks }, (_, k) => (
        <div key={`b${k}`} className="mo-cell blank" />
      ))}
      {month.days.map((d) => (
        <div key={d.date} className={`mo-cell${d.date === month.today ? ' is-today' : ''}`} {...dayButton(d.date, onOpenDay)}>
          <span className="n">{Number(d.date.slice(8))}</span>
          {d.deadlines.map((x) => (
            <div key={x.taskId} className={`ev ${x.done ? 'quiet done' : 'is-due'}`}>{dueText(x)}</div>
          ))}
          {d.events.map((e) => (
            <div key={e.id} className={`ev${e.done ? ' quiet done' : ''}`} style={catStyle(categories, e.categoryId)}>
              <i />
              {e.title ?? 'Event'}
            </div>
          ))}
          {d.chores.map((c) => (
            <div key={c.routineId} className="ev quiet">{c.title}</div>
          ))}
          {d.skippedClasses.map((c) => (
            <div key={c.id} className="ev quiet done">{classTitle(c)}</div>
          ))}
        </div>
      ))}
    </section>
  );
}
