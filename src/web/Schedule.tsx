import { useLayoutEffect, useMemo, type CSSProperties } from 'react';
import { weekday } from '../core/day';
import {
  DAY_FROM,
  DAY_TO,
  columns,
  hourLines,
  segmentHeight,
  segments,
  stepParts,
  totalHeight,
  yOf,
  type Segment,
  type StepPart,
} from '../core/timeline';
import type { CategoryView, DayView, ScheduleItem, SettingsView } from '../shared/api';
import { catStyle } from './cats';
import { movable, type BeginDrag, type DragView, type Geometry } from './drag';
import { cap, clockMin, fmtRange, fmtTime, joinAnd, planLabel, planTarget, relWord, shortLoc } from './format';
import { Check, Del, PencilIcon, PinIcon, PlusIcon, RepeatIcon } from './icons';

/** One block on the day, ready to draw. */
export interface Shown {
  key: string;
  item: ScheduleItem;
  look: 'class' | 'skipped' | 'routine' | 'event' | 'tentative' | 'open' | 'task';
  startMin: number;
  endMin: number;
  title: string;
  sub: string;
  categoryId: string | null;
  done: boolean;
  checkable: boolean;
  pinned: boolean;
  penciled: boolean;
  recurring: boolean;
  missed: boolean;
  parts: StepPart[];
}

const classTitle = (code: string, kind: string) => `${code}${kind ? ` ${kind.toLowerCase()}` : ''}`;

export function shown(item: ScheduleItem, today: string): Shown {
  const range = fmtRange(item.startMin, item.endMin);
  const base = { key: item.id, item, startMin: item.startMin, endMin: item.endMin, pinned: false, penciled: false, recurring: false, missed: false, parts: [] };
  if (item.type === 'class') {
    return {
      ...base, look: item.skipped ? 'skipped' : 'class', title: classTitle(item.code, item.kind),
      sub: item.skipped ? 'Skipping this one' : [range, shortLoc(item.location)].filter(Boolean).join(', '),
      categoryId: item.categoryId ?? 'class', done: false, checkable: false,
    };
  }
  if (item.type === 'routine') {
    return {
      ...base, look: 'routine', title: item.title, sub: range, categoryId: item.categoryId ?? 'routine', done: item.checked,
      checkable: true, recurring: true, pinned: item.changed, parts: stepParts(item.startMin, item.steps),
    };
  }
  if (item.kind === 'open') {
    return { ...base, look: 'open', title: item.title ?? 'Open time', sub: item.label ?? range, categoryId: item.categoryId, done: false, checkable: false };
  }
  if (item.kind === 'event') {
    return {
      ...base, look: item.tentative ? 'tentative' : 'event', title: item.title ?? 'Event', sub: item.label ?? range,
      categoryId: item.categoryId, done: item.done, checkable: true,
    };
  }
  const sub = item.missed
    ? `${range}. Not done yet`
    : [range, item.nextStep && `Next: ${item.nextStep}`, item.rolledFrom && `From ${relWord(today, item.rolledFrom)}`].filter(Boolean).join('. ');
  return {
    ...base, look: 'task', title: item.title ?? 'Task', sub, categoryId: item.categoryId, done: item.done, checkable: true,
    pinned: item.pinned, penciled: !item.pinned, missed: item.missed, parts: stepParts(item.startMin, item.steps),
  };
}

/** What the × (and the matching popover action) does to a block (spec §7). */
export function removeLabel(b: Shown): string {
  const item = b.item;
  if (item.type === 'class') return item.skipped ? 'Not skipping' : 'Skip this one';
  if (item.type === 'routine') return 'Skip this day';
  return item.kind === 'task' ? 'Back to the list' : 'Remove';
}

interface Props {
  day: DayView;
  settings: SettingsView;
  categories: CategoryView[];
  /** Now, when the day is today. */
  nowMin: number | null;
  opened: { early: boolean; late: boolean };
  onOpen: (id: 'early' | 'late', open: boolean) => void;
  onCheck: (b: Shown) => void;
  onCheckTask: (taskId: string, done: boolean) => void;
  onDetails: (b: Shown, el: HTMLElement) => void;
  onRemove: (b: Shown) => void;
  onClearSometime: (taskId: string) => void;
  /** Plans the given day. */
  onPlan: (date: string) => void;
  drag: { begin: BeginDrag; view: DragView | null; onGeometry: (g: Geometry) => void };
}

export function Schedule({ day, settings, categories, nowMin, opened, onOpen, onCheck, onCheckTask, onDetails, onRemove, onClearSometime, onPlan, drag }: Props) {
  const all = useMemo(() => day.schedule.map((x) => shown(x, day.today)), [day]);
  // While a block's bottom edge is dragged, it shows its new length.
  const t = drag.view?.target;
  const resizing = t?.kind === 'resize' && drag.view!.item.type === 'resize' ? { key: drag.view!.item.b.key, minutes: t.minutes } : null;
  const blocks = resizing
    ? all.map((b) => (b.key === resizing.key ? { ...b, endMin: b.startMin + resizing.minutes, sub: fmtRange(b.startMin, b.startMin + resizing.minutes) } : b))
    : all;
  const segs = segments({
    wakeMin: clockMin(settings.wakeTime),
    bedMin: clockMin(settings.bedTime),
    items: blocks,
    nowMin,
    opened,
  });
  const y = (m: number) => yOf(segs, m);
  const { onGeometry } = drag;
  useLayoutEffect(() => onGeometry({ segs, nowMin }));
  const ghost = t?.kind === 'grid' && drag.view ? { from: t.startMin, to: t.startMin + drag.view.item.minutes } : null;
  const target = planTarget(day.today, day.date, nowMin ?? 0);
  const isToday = day.date === day.today;
  const isPast = day.date < day.today;

  const open = blocks.filter((b) => b.look === 'open');
  const rest = blocks.filter((b) => b.look !== 'open');
  const cols = columns(rest);

  const dueByMin = new Map<number, string[]>();
  for (const d of day.deadlines) {
    if (d.atMin == null || d.done) continue;
    dueByMin.set(d.atMin, [...(dueByMin.get(d.atMin) ?? []), d.name]);
  }

  return (
    <section className="dayview" aria-label="Schedule">
      <div className="schedhead">
        <div className={`lane${t?.kind === 'sometime' ? ' drop-on' : ''}`} data-drop="sometime">
          <span className="lab">Sometime {isToday ? 'today' : weekdayName(day.date)}</span>
          {day.sometime.map((s) => (
            <div
              key={s.taskId}
              className={`chip${s.done ? ' done' : ''}`}
              style={catStyle(categories, s.categoryId)}
              onPointerDown={(e) => !s.done && drag.begin(e, { type: s.due ? 'task' : 'sometime', taskId: s.taskId, title: s.title, minutes: s.minutes }, e.currentTarget)}
            >
              <Check checked={s.done} label={s.title} onToggle={() => onCheckTask(s.taskId, !s.done)} />
              <i className="dot"></i>
              <span>{s.title}</span>
              {s.rolledFrom && <em className="from">from {relWord(day.today, s.rolledFrom)}</em>}
              {s.due ? <em className="from">due</em> : <Del label={`Back to the list: ${s.title}`} onClick={() => onClearSometime(s.taskId)} />}
            </div>
          ))}
        </div>
        {target && (
          <button className="box planbtn" onClick={() => onPlan(target)}>
            {planLabel(day.today, target)}
          </button>
        )}
      </div>

      <div className="grid" data-drop="grid" style={{ height: totalHeight(segs) }}>
        <Strips segs={segs} y={y} pastEnd={isToday ? nowMin! : isPast ? DAY_TO : DAY_FROM} onOpen={onOpen} />
        {hourLines(segs).map((m) => (
          <div
            key={m}
            className={`hour${m === 1440 ? ' midnight' : ''}${nowMin != null && Math.abs(m - nowMin) < 20 ? ' nolabel' : ''}`}
            style={{ top: y(m) }}
          >
            <span>{fmtTime(m)}</span>
          </div>
        ))}
        {isToday && nowMin! > DAY_FROM && <div className="past" style={{ height: y(Math.min(nowMin!, DAY_TO)) }} />}
        {isPast && <div className="past" style={{ height: y(DAY_TO) }} />}
        {isToday && nowMin! >= DAY_FROM && nowMin! <= DAY_TO && (
          <div className="now" style={{ top: y(nowMin!) - 1 }}>
            <span>{fmtTime(nowMin!)}</span>
          </div>
        )}
        {[...dueByMin].map(([m, names]) => (
          <div key={m} className="dueflag" style={{ top: y(m) }}>
            <span>
              Due {fmtTime(m)}: {cap(joinAnd(names))}
            </span>
          </div>
        ))}
        {open.map((b) => (
          <Block key={b.key} b={b} col={0} cols={1} y={y} categories={categories} onCheck={onCheck} onDetails={onDetails} onRemove={onRemove} begin={drag.begin} />
        ))}
        {rest.map((b, i) => (
          <Block
            key={b.key} b={b} col={cols[i]!.col} cols={cols[i]!.cols} y={y} categories={categories}
            onCheck={onCheck} onDetails={onDetails} onRemove={onRemove} begin={drag.begin}
          />
        ))}
        {ghost && (
          <div className="ghost" style={{ top: y(ghost.from) + 1, height: Math.max(y(ghost.to) - y(ghost.from) - 3, 20) }}>
            {fmtRange(ghost.from, ghost.to)}
          </div>
        )}
      </div>
    </section>
  );
}

const weekdayName = (date: string) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday(date)];

/** Folded strips, the shaded early and late stretches when open, and their Hide buttons. */
function Strips({ segs, y, pastEnd, onOpen }: { segs: Segment[]; y: (m: number) => number; pastEnd: number; onOpen: Props['onOpen'] }) {
  let acc = 0;
  const out = [];
  for (const s of segs) {
    const h = segmentHeight(s);
    const top = acc;
    acc += h;
    if (s.id === 'core') continue;
    const id = s.id;
    if (!s.open) {
      out.push(
        <button key={id} className="band" data-strip={id} style={{ top, height: h }} aria-label={`Show ${fmtRange(s.from, s.to)}`} onClick={() => onOpen(id, true)}>
          <b>{fmtRange(s.from, s.to)}</b>
          <span>{id === 'early' ? 'Early morning' : 'Late night'}</span>
          <PlusIcon />
        </button>,
      );
      continue;
    }
    const from = Math.max(s.from, pastEnd);
    if (from < s.to) out.push(<div key={`${id}-off`} className="offzone" style={{ top: y(from), height: y(s.to) - y(from) }} />);
    if (!s.forced) {
      out.push(
        <button key={`${id}-hide`} className="hidebtn" style={{ top: id === 'early' ? top + 14 : top + h - 30 }} onClick={() => onOpen(id, false)}>
          Hide
        </button>,
      );
    }
  }
  return <>{out}</>;
}

interface BlockProps {
  b: Shown;
  col: number;
  cols: number;
  y: (m: number) => number;
  categories: CategoryView[];
  onCheck: (b: Shown) => void;
  onDetails: (b: Shown, el: HTMLElement) => void;
  onRemove: (b: Shown) => void;
  begin: BeginDrag;
}

function Block({ b, col, cols, y, categories, onCheck, onDetails, onRemove, begin }: BlockProps) {
  const top = y(b.startMin);
  const height = Math.max(y(b.endMin) - top - 3, 20);
  const short = height < 37;
  const moves = movable(b);
  const minutes = b.endMin - b.startMin;
  const cls = [
    'block', b.look, b.done && 'done', !b.checkable && 'nocb', !moves && 'nodrag', b.missed && 'missed', short && 'short',
    b.parts.length && 'has-parts',
  ].filter(Boolean).join(' ');
  const style = {
    ...catStyle(categories, b.categoryId),
    top: top + 1,
    height,
    left: `calc(${(col / cols) * 100}% + 4px)`,
    width: `calc(${100 / cols}% - 8px)`,
  } as CSSProperties;

  return (
    <div
      className={cls}
      style={style}
      role="button"
      tabIndex={0}
      aria-label={`${b.title}, ${fmtRange(b.startMin, b.endMin)}. Details`}
      onClick={(e) => onDetails(b, e.currentTarget)}
      onPointerDown={(e) => moves && begin(e, { type: 'block', b, title: b.title, minutes }, e.currentTarget)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onDetails(b, e.currentTarget);
        }
      }}
    >
      {b.parts.map((p) => (
        <div
          key={p.startMin}
          className={`part${p.waiting ? ' waiting' : ''}`}
          style={{ top: y(p.startMin) - top, height: Math.max(y(p.endMin) - y(p.startMin) - 1, 2) }}
        >
          {p.waiting && y(p.endMin) - y(p.startMin) >= 18 && <span>{`${p.title}, ${p.endMin - p.startMin}m`}</span>}
        </div>
      ))}
      {b.checkable && <Check checked={b.done} label={b.title} onToggle={() => onCheck(b)} />}
      <div className="bt">
        <span className="tt">{b.title}</span>
        {b.pinned && <PinIcon />}
        {b.penciled && <PencilIcon />}
        {b.recurring && <RepeatIcon />}
      </div>
      <div className="bm">{b.sub}</div>
      <Del label={`${removeLabel(b)}: ${b.title}`} onClick={() => onRemove(b)} />
      {moves && (
        <div
          className="resize"
          aria-hidden="true"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            e.stopPropagation();
            begin(e, { type: 'resize', b, title: b.title, minutes }, e.currentTarget.parentElement!);
          }}
        />
      )}
    </div>
  );
}
