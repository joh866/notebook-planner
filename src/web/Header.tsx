import { DateTime } from 'luxon';
import { addDays, weekStartOf } from '../core/day';
import type { DayView, TaskCard } from '../shared/api';
import { deadlineOn, fmtTime, joinAnd, longDate, relWord, shortDate } from './format';
import { GearIcon } from './icons';

export type View = 'day' | 'week' | 'month';

interface Props {
  view: View;
  /** The selected day. */
  date: string;
  day: DayView;
  weekStart: number;
  /** Now, in the display zone. */
  now: DateTime;
  onView: (v: View) => void;
  onShift: (dir: -1 | 1) => void;
  onToday: () => void;
  onSettings: () => void;
}

const NAMES: Record<View, string> = { day: 'Day', week: 'Week', month: 'Month' };

function weekRange(date: string, weekStart: number) {
  const a = weekStartOf(date, weekStart);
  return { from: a, to: addDays(a, 6) };
}

function titles(view: View, date: string, weekStart: number): { wide: string; phone: string } {
  if (view === 'day') return { wide: longDate(date), phone: shortDate(date) };
  if (view === 'week') {
    const { from, to } = weekRange(date, weekStart);
    const A = DateTime.fromISO(from), Z = DateTime.fromISO(to);
    const t = A.month === Z.month ? `${A.toFormat('LLL d')} – ${Z.day}` : `${A.toFormat('LLL d')} – ${Z.toFormat('LLL d')}`;
    return { wide: t, phone: t };
  }
  const t = DateTime.fromISO(date).toFormat('LLLL yyyy');
  return { wide: t, phone: t };
}

/** True when today is on screen: the day itself, the week containing it, or the month containing it (spec §6). */
export function todayOnScreen(view: View, date: string, today: string, weekStart: number): boolean {
  if (view === 'day') return date === today;
  if (view === 'week') {
    const { from, to } = weekRange(date, weekStart);
    return today >= from && today <= to;
  }
  return date.slice(0, 7) === today.slice(0, 7);
}

export const allCards = (g: DayView['groups']): TaskCard[] =>
  [...g.overdue, ...g.near, ...g.week, ...g.soon, ...g.waiting.flatMap((w) => w.tasks), ...g.decide, ...g.ongoing, ...g.done];

/** "Math PSet 1, tomorrow at 11am." Tasks due at the same moment are named together. */
function nextDeadlineText(day: DayView): string | null {
  const next = day.header.nextDeadline;
  if (!next) return null;
  const all = allCards(day.groups);
  const same = all.filter((t) => !t.doneAt && t.dueAt === next.dueAt && t.dueDate === next.dueDate).map((t) => t.shortName ?? t.title);
  const names = same.length ? same : [next.name];
  const at = deadlineOn(next, day.zone)!;
  return `${joinAnd(names)}, ${relWord(day.today, at.date)}${at.min != null ? ` at ${fmtTime(at.min)}` : ''}.`;
}

const city = (zone: string) => zone.split('/').pop()!.replace(/_/g, ' ');

export function Header({ view, date, day, weekStart, now, onView, onShift, onToday, onSettings }: Props) {
  const away = !todayOnScreen(view, date, day.today, weekStart);
  const t = titles(view, date, weekStart);
  const clock = fmtTime(now.hour * 60 + now.minute);
  const overdue = day.header.overdue.map((o) => o.name);
  const next = nextDeadlineText(day);
  const back = (cls: string) => (
    <button className={`box tab backtoday ${cls}`} onClick={onToday}>
      Back to today
    </button>
  );

  return (
    <header className="top">
      <div className="headrow">
        <div className="daterow">
          <h1>
            <span className="wide-only">{t.wide}</span>
            <span className="phone-only">{t.phone}</span>
          </h1>
          {!away && <span className="clock">{clock}</span>}
          {away && back('phone-only')}
        </div>
        <div className="rightcluster">
          {away && back('wide-only')}
          <nav className="tabs" aria-label="Range">
            {(['day', 'week', 'month'] as const).map((v) =>
              v === view ? (
                <div key={v} className="box tab active" role="group" aria-label={`${NAMES[v]} view. Left half goes back, right half goes forward.`}>
                  <button className="half prev" aria-label={`Previous ${v}`} title={`Previous ${v}`} onClick={() => onShift(-1)} />
                  <span className="lbl">{NAMES[v]}</span>
                  <button className="half next" aria-label={`Next ${v}`} title={`Next ${v}`} onClick={() => onShift(1)} />
                </div>
              ) : (
                <button key={v} className="box tab" onClick={() => onView(v)}>
                  {NAMES[v]}
                </button>
              ),
            )}
          </nav>
          <button className="box sq" aria-label="Settings" title="Settings" onClick={onSettings}>
            <GearIcon />
          </button>
        </div>
      </div>
      <div className="rule"></div>
      {(overdue.length > 0 || next || day.zone !== day.homeZone) && (
        <p className="sub">
          {overdue.length > 0 && <span className="od">Overdue: {joinAnd(overdue)}. </span>}
          {next && (
            <>
              <span className="lab">Next deadline:</span> {next}
            </>
          )}
          {day.zone !== day.homeZone && (
            <span className="zone">
              Showing {city(day.zone)} time. Classes and deadlines are set in {city(day.homeZone)} time.
            </span>
          )}
        </p>
      )}
    </header>
  );
}
