import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Hono } from 'hono';
import { DateTime } from 'luxon';
import { chunkText } from '../core/chunk';
import { namesClass, type ClassName } from '../core/classes';
import { addDays, dayOf, weekday } from '../core/day';
import { localParse } from '../core/localParse';
import { systemPrompt } from '../core/prompt';
import { atMinute, clockOnDay, parseClock, resolveZone } from '../core/time';
import { firstFit, shapeOf } from '../core/planner';
import { effectiveWindow } from '../core/urgency';
import { twelveHour } from '../core/words';
import { AddInputSchema, ZoneSchema, type AddResult, type AddedItem } from '../shared/api';
import { categoryName, findCategory, nextColor } from '../shared/categories';
import { readAnswers, readChanges, readItems, type ParsedChange, type ParsedItem } from '../shared/parsed';
import type { Window } from '../shared/schemas';
import type { SortChunk } from './ai';
import type { Db } from './db/client';
import * as t from './db/schema';
import { readBody, type Run } from './resources';
import { findRows, tableOf, whereKey, type Change, type TableName, type Tx } from './undo';
import { promptExisting } from './addContext';
import { applyChanges } from './changes';
import { autoPencil } from './plan';
import { getSettings, planInputs } from './views';

// The add box (spec §11). The text is split into chunks that the AI sorts in parallel; a chunk that
// fails gets the local guess instead. Everything found is added right away, as one change with one
// Undo.

type Row = Record<string, unknown>;

interface Ctx {
  now: DateTime;
  /** The zone the user is in. Events typed as times happen here. */
  zone: string;
  /** Deadlines are Chicago moments (spec §3). */
  homeZone: string;
  /** The planner day (spec §3). */
  today: string;
  /** The calendar day that just started, between midnight and 4am. Otherwise `today`. "Today" in the text means this day. */
  calToday: string;
  /** #tags in the text. Only these can make new categories. */
  tags: Set<string>;
}

const iso = (d: DateTime) => d.toUTC().toISO({ suppressMilliseconds: true })!;
const isDay = (s: string | undefined): s is string => !!s && DateTime.fromFormat(s, 'yyyy-MM-dd').isValid;
/** Wall-clock minutes on a planner day: times before 4am are that day's night. */
const dayMinute = (hhmm: string) => {
  const m = parseClock(hhmm);
  return m < 4 * 60 ? m + 1440 : m;
};

/** "Around 7pm", "Around 7:30pm". */
function aroundLabel(m: number, note?: string): string {
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const at = `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
  return note ? `Around ${at}, ${note.charAt(0).toLowerCase()}${note.slice(1)}` : `Around ${at}`;
}

class Adder {
  private cats: Row[];
  private conditions: Row[];
  private classes: ClassName[];
  private order = new Map<TableName, number>();
  added: AddedItem[] = [];

  constructor(private tx: Tx, private change: Change, private ctx: Ctx) {
    this.cats = tx.select().from(t.categories).all() as Row[];
    this.conditions = tx.select().from(t.conditions).all() as Row[];
    this.classes = tx.select().from(t.classes).all();
  }

  /**
   * The day a dated time lands on (spec §10, "Never in the past"). After midnight, a late-night
   * time on the day that just started means tonight. With `roll`, a time that has already passed
   * today means its next occurrence.
   */
  private landing(date: string, time: string, zone: string, roll: boolean): string {
    const { today, calToday, now } = this.ctx;
    if (date === calToday && date !== today && parseClock(time) < 4 * 60) date = today;
    if (roll && (date === today || date === calToday) && clockOnDay(date, time, zone) < now) date = addDays(date, 1);
    return date;
  }

  private insert(name: TableName, rows: Row[]) {
    if (!rows.length) return;
    this.tx.insert(tableOf(name)).values(rows as never).run();
    this.change.created(name, rows);
  }

  /** The next sort order in a table, counting rows added in this change. */
  private nextOrder(name: TableName): number {
    let n = this.order.get(name);
    if (n == null) {
      const table = tableOf(name) as SQLiteTable & { sortOrder: unknown };
      const row = this.tx.select({ max: sql<number | null>`max(${table.sortOrder})` }).from(table).get() as { max: number | null } | undefined;
      n = (row?.max ?? -1) + 1;
    }
    this.order.set(name, n + 1);
    return n;
  }

  /** A known category, or a new one for a #tag in the text, or the fallback. */
  private category(raw: string | undefined, fallback: string | null): string | null {
    if (raw) {
      const found = findCategory(this.cats as never[], raw) as Row | undefined;
      if (found) return found.id as string;
      const tag = raw.replace(/^#/, '').trim().toLowerCase();
      if (this.ctx.tags.has(tag)) {
        const row: Row = {
          id: randomUUID(), name: categoryName(tag), color: nextColor(this.cats as never[]), builtin: false,
          sortOrder: this.nextOrder('categories'),
        };
        this.insert('categories', [row]);
        this.cats.push(row);
        return row.id as string;
      }
    }
    return fallback && this.cats.some((c) => c.id === fallback) ? fallback : null;
  }

  /** The open check-in question with these words, or a new one. */
  private condition(question: string, phrase: string | null): string {
    const q = question.trim();
    const found = this.conditions.find((c) => !c.answeredAt && String(c.question).toLowerCase() === q.toLowerCase());
    if (found) return found.id as string;
    const row: Row = { id: randomUUID(), question: q, phrase };
    this.insert('conditions', [row]);
    this.conditions.push(row);
    return row.id as string;
  }

  /** An item's "if" and "after" conditions (spec §10, "Conditions"). "After" links wait until everything is added. */
  private addConditions(p: ParsedItem, table: 'tasks' | 'blocks', row: Row) {
    const ask = p.ask ?? p.wait ?? (p.if ? `${p.if.charAt(0).toUpperCase()}${p.if.slice(1).replace(/[.?]+$/, '')}?` : null);
    if (ask) row.conditionId = this.condition(ask, p.if ?? null);
    if (p.after) this.afters.push({ table, id: row.id as string, after: p.after });
  }

  private afters: { table: 'tasks' | 'blocks'; id: string; after: string }[] = [];

  /**
   * Links "after" items to what they come after: an existing item's id, or a title, matched first
   * among the items just added, then among unfinished tasks and upcoming events.
   */
  linkAfters() {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const tasks = this.tx.select().from(t.tasks).all().filter((x) => !x.doneAt);
    const events = this.tx.select().from(t.blocks).all().filter((b) => b.kind === 'event' && b.title);
    const fresh = new Set(this.added.map((a) => a.id));
    const pool = [
      ...tasks.map((x) => ({ table: 'tasks' as const, id: x.id, title: x.title, fresh: fresh.has(x.id) })),
      ...events.map((b) => ({ table: 'blocks' as const, id: b.id, title: b.title!, fresh: fresh.has(b.id) })),
    ].sort((a, b) => Number(b.fresh) - Number(a.fresh));
    for (const link of this.afters) {
      const want = norm(link.after);
      const others = pool.filter((x) => x.id !== link.id);
      const hit = others.find((x) => x.id === link.after) ?? others.find((x) => norm(x.title) === want)
        ?? others.find((x) => want.length > 3 && (norm(x.title).includes(want) || want.includes(norm(x.title))));
      if (!hit) continue;
      const set = hit.table === 'tasks' ? { afterTaskId: hit.id, afterBlockId: null } : { afterTaskId: null, afterBlockId: hit.id };
      const table = link.table === 'tasks' ? t.tasks : t.blocks;
      const where = whereKey(link.table, { id: link.id });
      this.change.before(link.table, findRows(this.tx, link.table, where));
      this.tx.update(table).set(set).where(where).run();
    }
  }

  add(raw: ParsedItem) {
    // Times are always 12-hour (spec §4), including in text the AI wrote.
    const p: ParsedItem = {
      ...raw, title: twelveHour(raw.title), ...(raw.meta ? { meta: twelveHour(raw.meta) } : {}),
      ...(raw.steps ? { steps: raw.steps.map((x) => ({ ...x, title: twelveHour(x.title) })) } : {}),
    };
    if (p.type === 'class' && this.addClass(p)) return;
    if (p.type === 'routine') return this.addRoutine(p);
    if (p.type === 'event') return this.addEvent(p);
    // A task for today, with no time, goes in today's Sometime lane (spec §7).
    const { today, calToday } = this.ctx;
    if ((p.date === today || p.date === calToday) && !p.due && p.win !== 'decide') {
      return this.addTask(p, { window: 'near', sometime: calToday });
    }
    this.addTask(p);
  }

  private addTask(p: ParsedItem, forced?: { window: Window; sometime: string }) {
    const window: Window = forced?.window ?? p.win ?? 'soon';
    const row: Row = {
      id: randomUUID(), title: p.title, meta: p.meta ?? null, window,
      categoryId: this.category(p.cat, 'life'), sortOrder: this.nextOrder('tasks'),
      // Classes are never deadlines (spec §11): a short name that only names a class is dropped.
      shortName: p.short && !namesClass(p.short, this.classes) ? p.short : null,
      estLow: p.est?.[0] ?? null, estHigh: p.est?.[1] ?? null,
      sittingMinutes: p.sitting ?? null, sessionMinutes: p.session ?? null, quick: !!p.quick,
    };
    // A task that only names a class meeting gets no deadline.
    if (p.due && isDay(p.due.date) && !namesClass(p.title, this.classes)) {
      const { homeZone, today, calToday } = this.ctx;
      if (p.due.time) {
        // After midnight, a deadline earlier "today" means the day that just started.
        const date = this.landing(p.due.date, p.due.time, homeZone, today !== calToday);
        row.dueAt = iso(clockOnDay(date, p.due.time, homeZone));
      } else row.dueDate = p.due.date === today ? calToday : p.due.date;
    }
    this.addConditions(p, 'tasks', row);
    if (window === 'decide') row.decisionYes = { makeTask: { title: p.title.replace(/\s*\?+\s*$/, ''), window: 'soon' } };
    this.insert('tasks', [row]);
    this.insert('taskSteps', (p.steps ?? []).map((s, i) => ({
      id: randomUUID(), taskId: row.id, title: s.title, minutes: s.minutes ?? null, waiting: !!s.waiting, sortOrder: i,
    })));
    if (forced) {
      this.insert('sometime', [{ taskId: row.id, date: forced.sometime, rolledFrom: null }]);
      this.added.push({ kind: 'sometime', id: row.id as string, title: p.title, date: forced.sometime });
      return;
    }
    const shown = effectiveWindow({ window, dueAt: row.dueAt as string | undefined, dueDate: row.dueDate as string | undefined }, this.ctx.now, this.ctx.zone, this.ctx.homeZone);
    this.added.push({ kind: 'task', id: row.id as string, title: p.title, window: shown === 'done' ? window : shown });
  }

  private addRoutine(p: ParsedItem) {
    const days = p.repeat?.days;
    const weekly = Array.isArray(days);
    const weekdays = weekly ? [...new Set(days)].sort() : null;
    const every = weekly ? (p.repeat?.every ?? 1) : 1;
    let from: string | null = null;
    if (every > 1 && weekdays) {
      // Every other week counts from the first day it happens, starting today.
      from = this.ctx.today;
      while (!weekdays.includes(weekday(from))) from = addDays(from, 1);
    }
    const stepMinutes = (p.steps ?? []).reduce((sum, s) => sum + (s.minutes ?? 0), 0);
    const span = p.start && p.end ? (dayMinute(p.end) - dayMinute(p.start) + 1440) % 1440 : 0;
    const minutes = span || p.est?.[0] || p.session || stepMinutes || 15;
    const row: Row = {
      id: randomUUID(), title: p.title, categoryId: this.category('routine', 'routine'), durationMinutes: minutes,
      repeat: weekly ? 'weekly' : 'daily', repeatDays: weekdays, repeatEvery: every, repeatFrom: from,
      showStreak: /\bstreak\b/i.test(`${p.title} ${p.meta ?? ''}`), sortOrder: this.nextOrder('routines'),
    };
    this.insert('routines', [row]);
    this.insert('routineSteps', (p.steps ?? []).map((s, i) => ({
      id: randomUUID(), routineId: row.id, title: s.title, minutes: s.minutes ?? null, waiting: !!s.waiting, sortOrder: i,
    })));
    if (p.start) this.insert('routineSlots', [{ id: randomUUID(), routineId: row.id, start: p.start, durationMinutes: minutes }]);
    this.added.push({ kind: 'routine', id: row.id as string, title: p.title });
  }

  /** A weekly class needs its days and times. Without them it's added as a task instead. */
  private addClass(p: ParsedItem): boolean {
    const days = p.repeat?.days;
    if (!Array.isArray(days) || !p.start || !p.end || p.end <= p.start) return false;
    const row: Row = {
      id: randomUUID(), code: p.title, kind: p.kind ?? 'Class', fullName: p.meta ?? null, days: [...new Set(days)].sort(),
      start: p.start, end: p.end, timeZone: this.ctx.homeZone, location: p.loc ?? null, categoryId: this.category('class', 'class'),
    };
    this.insert('classes', [row]);
    this.added.push({ kind: 'class', id: row.id as string, title: `${p.title}${p.kind ? ` ${p.kind.toLowerCase()}` : ''}` });
    return true;
  }

  /** Events in a plan for the day with no time yet ("after X", "asap"): they get one once everything is added. */
  private deferred: { id: string; date: string; minutes: number }[] = [];

  /**
   * An event with a time goes on the schedule. One that comes "after" something or "asap" gets its
   * time once everything is added. Without either, it's a task in that day's Sometime lane.
   */
  private addEvent(p: ParsedItem) {
    let date = isDay(p.date) ? p.date : this.ctx.calToday;
    if (date === this.ctx.today) date = this.ctx.calToday;
    const deferred = !p.start && (!!p.after || !!p.asap);
    if (!p.start && !deferred) return this.addTask(p, { window: 'near', sometime: date });
    // A deferred event starts now for the moment; placeDeferred moves it.
    const clock = p.start ?? this.ctx.now.setZone(this.ctx.zone).toFormat('HH:mm');
    if (p.start) date = this.landing(date, p.start, this.ctx.zone, true);
    else date = dayOf(this.ctx.now, this.ctx.zone);
    const start = dayMinute(clock);
    let end = p.end ? dayMinute(p.end) : start + (p.minutes ?? 60);
    if (end <= start) end = start + (p.minutes ?? 60);
    const startAt = iso(atMinute(date, start, this.ctx.zone));
    const row: Row = {
      id: randomUUID(), kind: 'event', title: p.title, categoryId: this.category(p.cat, null),
      startAt, durationMinutes: end - start, tentative: !!p.tentative,
      label: p.tentative ? aroundLabel(start, p.meta) : (p.meta ?? null), location: p.loc ?? null, pinned: true,
    };
    this.addConditions(p, 'blocks', row);
    this.insert('blocks', [row]);
    this.added.push({ kind: 'event', id: row.id as string, title: p.title, date, startAt });
    if (deferred) this.deferred.push({ id: row.id as string, date, minutes: end - start });
  }

  /**
   * Gives "after" and "asap" events their times (spec §11, "A plan for the day"): right when what
   * they come after ends, or else the earliest free time from now. Never in the past.
   */
  placeDeferred(free: (date: string, skip: Set<string>) => { from: number; to: number; busy: [number, number][] }) {
    const utc = (x: string) => DateTime.fromISO(x, { zone: 'utc' });
    for (const d of this.deferred) {
      const row = this.tx.select().from(t.blocks).where(eq(t.blocks.id, d.id)).get()!;
      let start: DateTime | null = null;
      const pre = row.afterBlockId
        ? this.tx.select().from(t.blocks).where(eq(t.blocks.id, row.afterBlockId)).all()
        : row.afterTaskId ? this.tx.select().from(t.blocks).where(eq(t.blocks.taskId, row.afterTaskId)).all() : [];
      const ends = pre.map((b) => utc(b.startAt).plus({ minutes: b.durationMinutes })).sort((a, b) => a.toMillis() - b.toMillis()).at(-1);
      if (ends && ends > this.ctx.now) start = ends;
      if (!start) {
        const day = free(d.date, new Set([d.id]));
        const at = firstFit(day.from, day.to, shapeOf(d.minutes, []), day.busy);
        start = at == null ? this.ctx.now : atMinute(d.date, at, this.ctx.zone);
      }
      const startAt = iso(start);
      this.change.before('blocks', [row]);
      this.tx.update(t.blocks).set({ startAt }).where(eq(t.blocks.id, d.id)).run();
      const a = this.added.find((x) => x.id === d.id);
      if (a?.kind === 'event') {
        a.startAt = startAt;
        a.date = dayOf(start, this.ctx.zone);
      }
    }
  }
}

export function registerAdds(app: Hono, db: Db, run: Run, now: () => DateTime, sort: SortChunk) {
  app.post('/api/add', async (c) => {
    const q = c.req.query('tz');
    const device = q === undefined ? undefined : ZoneSchema.parse(q);
    const { text } = await readBody(c, AddInputSchema);
    const settings = getSettings(db);
    const zone = resolveZone(settings.timeZone, device ?? settings.homeTimeZone);
    const at = now();
    const today = dayOf(at, zone);
    const calToday = at.setZone(zone).toFormat('yyyy-MM-dd');

    const system = systemPrompt({
      today,
      time: at.setZone(zone).toFormat('HH:mm'),
      classes: db.select().from(t.classes).all(),
      customCategories: db.select().from(t.categories).all().filter((x) => !x.builtin).map((x) => x.name),
      existing: promptExisting(db, at, zone, settings.homeTimeZone, today),
    });
    const chunks = chunkText(text);
    const settled = await Promise.allSettled(chunks.map((chunk) => sort(system, chunk)));

    let fellBack = 0;
    let reason: string | null = null;
    const changes: ParsedChange[] = [];
    const answers = new Set<string>();
    const items = settled.flatMap((r, i) => {
      if (r.status === 'fulfilled') {
        // A reply is the whole object, or (from older callers) just the items.
        const reply = Array.isArray(r.value) ? { items: r.value, changes: [], answers: [] } : r.value;
        changes.push(...readChanges(reply.changes));
        for (const a of readAnswers(reply.answers)) answers.add(a);
        return readItems(reply.items);
      }
      fellBack++;
      reason ??= r.reason instanceof Error ? r.reason.message : String(r.reason);
      return localParse(chunks[i]!, calToday);
    });

    const tags = new Set([...text.matchAll(/#([\w-]+)/g)].map((m) => m[1]!.toLowerCase()));
    return c.json(run((tx, change): AddResult => {
      const adder = new Adder(tx, change, { now: at, zone, homeZone: settings.homeTimeZone, today, calToday, tags });
      for (const item of items) adder.add(item);
      adder.linkAfters();
      adder.placeDeferred((date, skip) => planInputs(db, at, device).day(date, skip));
      // Changes to what already exists (spec §11), in the same Undo.
      const done = applyChanges(tx, change, { now: at, zone, homeZone: settings.homeTimeZone, today, calToday }, changes);
      // With automatic scheduling on, new tasks that are due soon get penciled in (spec §12).
      const tasks = adder.added.filter((a) => a.kind === 'task');
      const penciled = autoPencil(db, tx, change, at, device, tasks.map((a) => a.id));
      for (const a of tasks) a.penciled = penciled.get(a.id) ?? null;
      // Check-ins the text seems to answer: the message offers Yes (spec §11).
      const offers = tx.select().from(t.conditions).all()
        .filter((q) => answers.has(q.id) && !q.answeredAt)
        .map((q) => ({ conditionId: q.id, question: q.question }));
      return { added: adder.added, chunks: chunks.length, fellBack, reason, ...done, offers };
    }));
  });
}
