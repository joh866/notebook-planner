import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { weekday } from '../core/day';
import { WEEK_HOUR_PX, columns, weekHours } from '../core/timeline';
import type { CategoryView, SettingsView, WeekView } from '../shared/api';
import { dueText } from './agenda';
import { catStyle } from './cats';
import { dayButton } from './dayButton';
import { clockMin, fmtRange, fmtTime, longDate } from './format';
import { shown } from './Schedule';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  week: WeekView;
  settings: SettingsView;
  categories: CategoryView[];
  /** Minutes on today, for the now line. */
  nowMin: number;
  onOpenDay: (date: string) => void;
}

/** The week as a time grid in its own scrolling box (spec §8, "Week, wide"). */
export function Week({ week, settings, categories, nowMin, onOpenDay }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const { today } = week;
  const days = week.days.map((d) => ({
    ...d,
    blocks: d.schedule.filter((x) => !(x.type === 'block' && x.kind === 'open')).map((x) => shown(x, today)),
  }));
  const hasToday = days.some((d) => d.date === today);
  // Stretches to the current time too, so the now line shows when you're up late.
  const spans = [...days.flatMap((d) => d.blocks), ...(hasToday ? [{ startMin: nowMin, endMin: nowMin + 30 }] : [])];
  const hours = weekHours(clockMin(settings.wakeTime), clockMin(settings.bedTime), spans);
  const y = (m: number) => ((m - hours.from) / 60) * WEEK_HOUR_PX;
  const height = y(hours.to);
  const lines: number[] = [];
  for (let m = hours.from + 60; m < hours.to; m += 60) lines.push(m);
  const showNow = hasToday && nowMin >= hours.from && nowMin <= hours.to;

  // Opens scrolled to the current time when today is in the week.
  const nowY = showNow ? y(nowMin) : null;
  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = nowY == null ? 0 : Math.max(0, nowY - 160);
    // Only when a different week opens, not on every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week.start]);

  return (
    <section className="wk-box" ref={box} aria-label={`Week of ${longDate(week.start)}`}>
      <div className="wk-top">
        <div className="wk-corner" />
        {days.map((d) => (
          <div key={d.date} className={`wk-dh${d.date === today ? ' is-today' : ''}`} {...dayButton(d.date, onOpenDay)}>
            <span>{SHORT_DAYS[weekday(d.date)]}</span>
            <b>{Number(d.date.slice(8))}</b>
          </div>
        ))}
        <div className="wk-corner" />
        {days.map((d) => (
          <div key={d.date} className="wk-ad" {...dayButton(d.date, onOpenDay)}>
            {d.deadlines.filter((x) => !x.done).map((x) => (
              <span key={x.taskId} className="d">{dueText(x)}</span>
            ))}
            {d.sometime.map((s) => (
              <span key={s.taskId} className={`s${s.done ? ' done' : ''}`} style={catStyle(categories, s.categoryId)}>
                {s.title}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="wk-body" style={{ height }}>
        <div className="wk-gut" style={{ height }}>
          {lines.map((m) => (
            <span key={m} style={{ top: y(m) }}>{fmtTime(m)}</span>
          ))}
        </div>
        {days.map((d) => {
          const placed = columns(d.blocks);
          return (
            <div key={d.date} className={`wk-col${d.date === today ? ' is-today' : ''}`} {...dayButton(d.date, onOpenDay)}>
              {lines.map((m) => (
                <div key={m} className="wk-line" style={{ top: y(m) }} />
              ))}
              {d.deadlines
                .filter((x) => !x.done && x.atMin != null && x.atMin >= hours.from && x.atMin <= hours.to)
                .map((x) => (
                  <div key={x.taskId} className="wk-dueline" style={{ top: y(x.atMin!) }} />
                ))}
              {d.blocks.map((b, i) => {
                const top = y(b.startMin);
                const h = Math.max(y(b.endMin) - top - 2, 15);
                const p = placed[i]!;
                const style = {
                  ...catStyle(categories, b.categoryId),
                  top: top + 1,
                  height: h,
                  left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                  width: `calc(${100 / p.cols}% - 4px)`,
                } as CSSProperties;
                return (
                  <div key={b.key} className={`wk-b ${b.look}${b.done ? ' done' : ''}`} style={style}>
                    <b>{b.title}</b>
                    {h > 28 && <span>{fmtRange(b.startMin, b.endMin)}</span>}
                  </div>
                );
              })}
              {d.date === today && showNow && <div className="wk-now" style={{ top: y(nowMin) }} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
