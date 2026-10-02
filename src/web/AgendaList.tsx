import type { CategoryView, MonthDay } from '../shared/api';
import { agendaDayLabel, agendaLines } from './agenda';
import { catStyle } from './cats';
import { dayButton } from './dayButton';

interface Props {
  today: string;
  days: MonthDay[];
  categories: CategoryView[];
  empty: string;
  onOpenDay: (date: string) => void;
}

/** Days with their deadlines, events, and skipped classes. Used by Coming up (spec §5) and the phone month (spec §8). */
export function AgendaList({ today, days, categories, empty, onOpenDay }: Props) {
  const shown = days.map((d) => ({ date: d.date, lines: agendaLines(d) })).filter((d) => d.lines.length);
  if (!shown.length) return <div className="cu-empty">{empty}</div>;
  return (
    <>
      {shown.map((d) => (
        <div key={d.date} className="cu-day" {...dayButton(d.date, onOpenDay)}>
          <div className="cu-date">{agendaDayLabel(today, d.date)}</div>
          {d.lines.map((l) => (
            <div key={l.key} className={`cu-item${l.due ? ' is-due' : ''}`} style={catStyle(categories, l.categoryId)}>
              {!l.due && <i />}
              <span>{l.text}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
