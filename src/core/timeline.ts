// Day schedule geometry (spec §7). Minutes are wall-clock minutes after the day's midnight, so
// times after midnight run past 1440 (1am is 1500).

export const HOUR_PX = 52;
/** Height of a folded strip. */
export const BAND_PX = 30;
/** The earliest and latest minutes the schedule shows: 6am and 3am the next night. */
export const DAY_FROM = 6 * 60;
export const DAY_TO = 27 * 60;
/** A late strip opens on its own this long before bedtime. */
const LATE_LEAD = 120;

export type SegmentId = 'early' | 'core' | 'late';

export interface Segment {
  id: SegmentId;
  from: number;
  to: number;
  open: boolean;
  /** Something forces it open, so it can't be hidden. */
  forced: boolean;
}

export interface Span {
  startMin: number;
  endMin: number;
}

export interface SegmentInput {
  wakeMin: number;
  bedMin: number;
  /** What's on the schedule that day. */
  items: Span[];
  /** Now, when the day is today. */
  nowMin: number | null;
  /** Strips the user opened. */
  opened: { early: boolean; late: boolean };
}

/**
 * The day's three stretches: early morning (6am to wake-up) and late night (bedtime to 3am) fold
 * into thin strips unless opened, or forced open by something scheduled there or by the current
 * time being inside them (or within 2 hours of bedtime).
 */
export function segments({ wakeMin, bedMin, items, nowMin, opened }: SegmentInput): Segment[] {
  const wake = Math.max(DAY_FROM, Math.min(wakeMin, DAY_TO));
  const bed = Math.max(wake, Math.min(bedMin, DAY_TO));
  const any = (a: number, b: number) => items.some((x) => x.startMin < b && x.endMin > a);
  const earlyForced = any(DAY_FROM, wake) || (nowMin != null && nowMin >= DAY_FROM && nowMin < wake);
  const lateForced = any(bed, DAY_TO) || (nowMin != null && nowMin >= bed - LATE_LEAD);
  const list: Segment[] = [
    { id: 'early', from: DAY_FROM, to: wake, open: opened.early || earlyForced, forced: earlyForced },
    { id: 'core', from: wake, to: bed, open: true, forced: true },
    { id: 'late', from: bed, to: DAY_TO, open: opened.late || lateForced, forced: lateForced },
  ];
  return list.filter((s) => s.to > s.from);
}

export const segmentHeight = (s: Segment) => (s.open ? ((s.to - s.from) / 60) * HOUR_PX : BAND_PX);

export const totalHeight = (segs: Segment[]) => segs.reduce((sum, s) => sum + segmentHeight(s), 0);

/** The pixel offset of a minute from the top of the schedule. */
export function yOf(segs: Segment[], m: number): number {
  let y = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (m <= s.to || i === segs.length - 1) {
      if (m <= s.from) return y;
      const mm = Math.min(m, s.to);
      return y + (s.open ? ((mm - s.from) / 60) * HOUR_PX : (BAND_PX * (mm - s.from)) / (s.to - s.from));
    }
    y += segmentHeight(s);
  }
  return y;
}

/** The hour lines to draw: every whole hour inside an open stretch. */
export function hourLines(segs: Segment[]): number[] {
  const out = new Set<number>();
  for (const s of segs) {
    if (!s.open) continue;
    for (let m = Math.ceil(s.from / 60) * 60; m <= s.to; m += 60) out.add(m);
  }
  return [...out].sort((a, b) => a - b);
}

export interface Placed {
  /** Which column, from 0. */
  col: number;
  /** How many columns its overlap group shares. */
  cols: number;
}

/**
 * Overlapping blocks share the width side by side. Returns one placement per input, in input order.
 */
export function columns(list: Span[]): Placed[] {
  const order = list.map((_, i) => i).sort((a, b) => list[a]!.startMin - list[b]!.startMin || list[b]!.endMin - list[a]!.endMin);
  const out: Placed[] = list.map(() => ({ col: 0, cols: 1 }));
  let group: number[] = [];
  let ends: number[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    for (const i of group) out[i]!.cols = ends.length;
    group = [];
    ends = [];
    groupEnd = -Infinity;
  };
  for (const i of order) {
    const b = list[i]!;
    if (group.length && b.startMin >= groupEnd) close();
    let col = ends.findIndex((e) => e <= b.startMin);
    if (col < 0) {
      col = ends.length;
      ends.push(0);
    }
    ends[col] = b.endMin;
    out[i]!.col = col;
    group.push(i);
    groupEnd = Math.max(groupEnd, b.endMin);
  }
  close();
  return out;
}

export interface StepPart {
  title: string;
  startMin: number;
  endMin: number;
  waiting: boolean;
}

/**
 * The hands-on and waiting parts of something with timed steps, laid end to end from `startMin`
 * (spec §10, "Waiting time inside a task"). Empty unless there's a waiting step, since only then
 * does the block need splitting. Steps without a length are left out.
 */
export function stepParts(startMin: number, steps: { title: string; minutes: number | null; waiting: boolean }[]): StepPart[] {
  if (!steps.some((s) => s.waiting && s.minutes)) return [];
  const out: StepPart[] = [];
  let at = startMin;
  for (const s of steps) {
    if (!s.minutes) continue;
    out.push({ title: s.title, startMin: at, endMin: at + s.minutes, waiting: s.waiting });
    at += s.minutes;
  }
  return out;
}

// ---------- Drops and resizing (spec §7, §10) ----------

/** Drops and resizes snap to this many minutes. */
export const SNAP = 15;

/** The minute at a pixel offset from the top of the schedule. The inverse of `yOf`. */
export function minuteAt(segs: Segment[], y: number): number {
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    const h = segmentHeight(s);
    if (y < acc + h || i === segs.length - 1) {
      const into = Math.max(0, Math.min(y - acc, h));
      return s.from + (s.open ? (into / HOUR_PX) * 60 : (into / BAND_PX) * (s.to - s.from));
    }
    acc += h;
  }
  return DAY_FROM;
}

/**
 * Where something `minutes` long dropped at minute `m` starts: snapped to 15 minutes, not before
 * now (when the day is today), not inside a folded strip, and ending by 3am. Null when nothing
 * fits, like late at night on today.
 */
export function dropStart(segs: Segment[], m: number, minutes: number, nowMin: number | null): number | null {
  const early = segs.find((s) => s.id === 'early');
  const late = segs.find((s) => s.id === 'late');
  let lo = DAY_FROM;
  if (nowMin != null) lo = Math.max(lo, Math.ceil(nowMin / SNAP) * SNAP);
  if (early && !early.open) lo = Math.max(lo, early.to);
  const hi = (late && !late.open ? late.from : DAY_TO) - minutes;
  if (lo > hi) return null;
  return Math.max(lo, Math.min(hi, Math.round(m / SNAP) * SNAP));
}

/** A block's new length when its bottom edge is dragged to `endMin`: snapped, at least 15 minutes, ending by 3am. */
export function resizedLength(startMin: number, endMin: number): number {
  const end = Math.round(endMin / SNAP) * SNAP;
  return Math.max(SNAP, Math.min(DAY_TO - startMin, end - startMin));
}
