import { DateTime } from 'luxon';
import { monthCells } from '../core/day';
import type { AgendaView, CategoryView, MonthView } from '../shared/api';
import { agendaDayLabel, agendaLines } from './agenda';
import { catStyle } from './cats';
import { dayButton } from './dayButton';
import { longDate } from './format';

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props {
  /** The selected day's month. */
  month: MonthView;
  coming: AgendaView;
  /** The selected day. */
  selected: string;
  categories: CategoryView[];
  onOpenDay: (date: string) => void;
}

/** The left rail on screens 1400px and wider: a mini month and Coming up (spec §5). */
export function Rail({ month, coming, selected, categories, onOpenDay }: Props) {
  const ws = month.weekStart;
  const cells = monthCells(month.month, ws);
  const due = new Set(month.days.filter((d) => d.deadlines.some((x) => !x.done)).map((d) => d.date));
  const days = coming.days.map((d) => ({ date: d.date, lines: agendaLines(d) })).filter((d) => d.lines.length);

  return (
    <aside className="rail" aria-label="Calendar and what’s coming up">
      <div className="rail-box">
        <div className="rail-h">{DateTime.fromFormat(month.month, 'yyyy-MM').toFormat('LLLL')}</div>
        <div className="mini">
          {Array.from({ length: 7 }, (_, k) => (
            <span key={`h${k}`} className="mh" aria-hidden="true">{LETTERS[(ws + k) % 7]}</span>
          ))}
          {cells.map((d) => {
            const cls = [d === month.today && 'is-today', d === selected && 'sel', d.slice(0, 7) !== month.month && 'other'].filter(Boolean).join(' ');
            return (
              <button key={d} className={cls} aria-label={longDate(d)} title={longDate(d)} onClick={() => onOpenDay(d)}>
                {Number(d.slice(8))}
                {due.has(d) && <i />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="rail-box">
        <div className="rail-h">Coming up</div>
        {days.length === 0 && <div className="cu-empty">Nothing coming up in the next 10 days.</div>}
        {days.map((d) => (
          <div key={d.date} className="cu-day" {...dayButton(d.date, onOpenDay)}>
            <div className="cu-date">{agendaDayLabel(coming.today, d.date)}</div>
            {d.lines.map((l) => (
              <div key={l.key} className={`cu-item${l.due ? ' is-due' : ''}`} style={catStyle(categories, l.categoryId)}>
                {!l.due && <i />}
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

