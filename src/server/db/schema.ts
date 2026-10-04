import { sql } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import {
  BlockKindSchema,
  DurationFeedbackSchema,
  LookSettingSchema,
  WindowSchema,
  type DecisionYes,
  type Notify,
} from '../../shared/schemas';

// Conventions (AGENTS.md):
// - Durations are whole minutes.
// - Fixed moments are UTC ISO strings (`...At` columns).
// - Times that follow the user are local "HH:mm" (`start`, `wakeTime`, ...).
// - Calendar days are local "yyyy-MM-dd" (`date`, `...Date` columns), counted from the 4am boundary.
// - Weekdays are 0–6, Sunday = 0.

/** Zod 4 enum options as the non-empty tuple Drizzle expects. */
const opts = <T extends string>(e: { options: T[] }) => e.options as [T, ...T[]];

const id = () => text('id').primaryKey();
const createdAt = () => text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

export const categories = sqliteTable('categories', {
  id: id(),
  name: text('name').notNull(),
  /** Null for built-ins, which use the palette in spec §4. */
  color: text('color'),
  builtin: integer('builtin', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** "If" conditions: check-in questions (spec §10, "Conditions"). */
export const conditions = sqliteTable('conditions', {
  id: id(),
  question: text('question').notNull(),
  /** How it reads under an item's title ("if it's open", "once the cold is fully gone"). */
  phrase: text('phrase'),
  /** "Not yet" hides the question until this day. */
  snoozedUntil: text('snoozed_until'),
  answeredAt: text('answered_at'),
});

export const tasks = sqliteTable('tasks', {
  id: id(),
  title: text('title').notNull(),
  meta: text('meta'),
  notes: text('notes'),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  window: text('window', { enum: opts(WindowSchema) }).notNull(),
  /** A deadline is either `dueAt` (a time was given) or `dueDate` (day only), never both. */
  dueAt: text('due_at'),
  dueDate: text('due_date'),
  /** 2–4 word name used in deadline lines. */
  shortName: text('short_name'),
  estLow: integer('est_low'),
  estHigh: integer('est_high'),
  /** Length of one work session for big tasks. */
  sittingMinutes: integer('sitting_minutes'),
  /** Minutes per session for skill-building items. */
  sessionMinutes: integer('session_minutes'),
  /** An "if" condition. Yes on its question clears it (spec §10, "Conditions"). */
  conditionId: text('condition_id').references(() => conditions.id, { onDelete: 'set null' }),
  /** An "after" condition: the task or event this comes after. */
  afterTaskId: text('after_task_id').references((): AnySQLiteColumn => tasks.id, { onDelete: 'set null' }),
  afterBlockId: text('after_block_id').references((): AnySQLiteColumn => blocks.id, { onDelete: 'set null' }),
  decisionYes: text('decision_yes', { mode: 'json' }).$type<DecisionYes>(),
  doneAt: text('done_at'),
  durationFeedback: text('duration_feedback', { enum: opts(DurationFeedbackSchema) }),
  /** When you last changed the estimate yourself. The add box learns from these (spec §10, "Better estimates"). */
  estEditedAt: text('est_edited_at'),
  /** Marked quick by the add box (a text, an email, a tiny chore). Anything estimated at 15 minutes or less counts too (spec §10). */
  quick: integer('quick', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

export const taskSteps = sqliteTable('task_steps', {
  id: id(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  /** Length of this step, when known (spec §10, "Waiting time inside a task"). */
  minutes: integer('minutes'),
  /** True for waiting parts (a wash cycle), which count as free time. Hands-on by default. */
  waiting: integer('waiting', { mode: 'boolean' }).notNull().default(false),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const routines = sqliteTable('routines', {
  id: id(),
  title: text('title').notNull(),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  durationMinutes: integer('duration_minutes').notNull(),
  repeat: text('repeat', { enum: ['daily', 'weekly'] }).notNull(),
  /** Weekdays for weekly repeats. */
  repeatDays: text('repeat_days', { mode: 'json' }).$type<number[]>(),
  /** 1 = every week, 2 = every other week. */
  repeatEvery: integer('repeat_every').notNull().default(1),
  /** First day the repeat counts from (needed for every other week). */
  repeatFrom: text('repeat_from'),
  showStreak: integer('show_streak', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** A routine checked off on a given day. */
export const routineChecks = sqliteTable(
  'routine_checks',
  {
    routineId: text('routine_id').notNull().references(() => routines.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
  },
  (t) => [primaryKey({ columns: [t.routineId, t.date] })],
);

/** Time actually spent on a task (spec §10, "Actual time and the time log"). No end while it's running. */
export const taskSessions = sqliteTable('task_sessions', {
  id: id(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  startAt: text('start_at').notNull(),
  endAt: text('end_at'),
  createdAt: createdAt(),
});

/** Steps of a routine, like laundry's wash and dry cycles. Same shape as task steps. */
export const routineSteps = sqliteTable('routine_steps', {
  id: id(),
  routineId: text('routine_id').notNull().references(() => routines.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  minutes: integer('minutes'),
  waiting: integer('waiting', { mode: 'boolean' }).notNull().default(false),
  /** A streak can belong to a step, like gratitude (spec §9). */
  showStreak: integer('show_streak', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** A routine step checked off on a given day. Each step checks off on its own. */
export const routineStepChecks = sqliteTable(
  'routine_step_checks',
  {
    stepId: text('step_id').notNull().references(() => routineSteps.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
  },
  (t) => [primaryKey({ columns: [t.stepId, t.date] })],
);

/** A routine's time on the schedule, on every day it occurs. */
export const routineSlots = sqliteTable('routine_slots', {
  id: id(),
  routineId: text('routine_id').notNull().references(() => routines.id, { onDelete: 'cascade' }),
  start: text('start').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
});

/** One day's change to a routine slot: skipped, or moved/resized for that day only. */
export const routineSlotExceptions = sqliteTable(
  'routine_slot_exceptions',
  {
    slotId: text('slot_id').notNull().references(() => routineSlots.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    skipped: integer('skipped', { mode: 'boolean' }).notNull().default(false),
    start: text('start'),
    durationMinutes: integer('duration_minutes'),
  },
  (t) => [primaryKey({ columns: [t.slotId, t.date] })],
);

/** Weekly classes. Times are wall-clock in `timeZone`, so they shift when traveling (spec §3). */
export const classes = sqliteTable('classes', {
  id: id(),
  code: text('code').notNull(),
  kind: text('kind').notNull(),
  fullName: text('full_name'),
  days: text('days', { mode: 'json' }).notNull().$type<number[]>(),
  start: text('start').notNull(),
  end: text('end').notNull(),
  timeZone: text('time_zone').notNull().default('America/Chicago'),
  location: text('location'),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
});

export const classSkips = sqliteTable(
  'class_skips',
  {
    classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
  },
  (t) => [primaryKey({ columns: [t.classId, t.date] })],
);

/** One-off blocks: events, open time, and tasks placed on the schedule. */
export const blocks = sqliteTable('blocks', {
  id: id(),
  kind: text('kind', { enum: opts(BlockKindSchema) }).notNull(),
  /** For events and open time. Task blocks take the task's title. */
  title: text('title'),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  taskId: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  startAt: text('start_at').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  /** "Around 7" events. */
  tentative: integer('tentative', { mode: 'boolean' }).notNull().default(false),
  label: text('label'),
  location: text('location'),
  /** True when the user placed it; false when the planner penciled it in. */
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(true),
  /** Why the planner placed it ("Due Tue 2pm"). */
  reason: text('reason'),
  /** The day an unfinished task rolled over from. */
  rolledFrom: text('rolled_from'),
  /** For events. Task blocks use the task's doneAt. */
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  /** A logged block: the session it shows, at the time it actually happened. */
  sessionId: text('session_id').references(() => taskSessions.id, { onDelete: 'set null' }),
  /** Conditions on an event, as on tasks. Task blocks use their task's. */
  conditionId: text('condition_id').references(() => conditions.id, { onDelete: 'set null' }),
  afterTaskId: text('after_task_id').references((): AnySQLiteColumn => tasks.id, { onDelete: 'set null' }),
  afterBlockId: text('after_block_id').references((): AnySQLiteColumn => blocks.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

/** The tasks in a "Quick things" block (spec §10). A task is in one batch at most. */
export const quickItems = sqliteTable(
  'quick_items',
  {
    blockId: text('block_id').notNull().references(() => blocks.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.blockId, t.taskId] })],
);

/** Tasks committed to a day without a time (spec §7). One per task. */
export const sometime = sqliteTable('sometime', {
  taskId: text('task_id').primaryKey().references(() => tasks.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  rolledFrom: text('rolled_from'),
});

/** A single row (id = 1). */
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  wakeTime: text('wake_time').notNull().default('09:00'),
  bedTime: text('bed_time').notNull().default('00:00'),
  look: text('look', { enum: opts(LookSettingSchema) }).notNull().default('auto'),
  /** "auto" follows the device. */
  timeZone: text('time_zone').notNull().default('auto'),
  homeTimeZone: text('home_time_zone').notNull().default('America/Chicago'),
  autoSchedule: integer('auto_schedule', { mode: 'boolean' }).notNull().default(false),
  weekStart: integer('week_start').notNull().default(0),
  notify: text('notify', { mode: 'json' }).notNull().$type<Notify>(),
  canvasFeedUrl: text('canvas_feed_url'),
  /** The last Canvas fetch, and what it found or why it failed (spec §14). Never the link itself. */
  /** Themes (spec §4, §13): one for the day and one for the night. */
  dayTheme: text('day_theme').notNull().default('notebook-day'),
  nightTheme: text('night_theme').notNull().default('notebook-night'),
  canvasSyncedAt: text('canvas_synced_at'),
  canvasNote: text('canvas_note'),
});

/**
 * Items brought in from a calendar feed (spec §14, "Canvas"), by the feed's own id. `snapshot` is
 * what the feed last wrote, so a field the user changed is never overwritten. A task the user
 * deleted keeps its row with no task, so it isn't brought back.
 */
export const feedItems = sqliteTable('feed_items', {
  uid: text('uid').primaryKey(),
  source: text('source', { enum: ['canvas'] }).notNull(),
  taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  snapshot: text('snapshot', { mode: 'json' }).notNull().$type<{ title: string; meta: string | null; dueAt: string | null; dueDate: string | null }>(),
  lastSeenAt: text('last_seen_at').notNull(),
});

/**
 * Devices that get notifications (spec §14, "Notifications"): one web push subscription each, by its
 * push service address. `zone` is the device's time zone when it last opened the app, used when the
 * time zone setting is "auto".
 */
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  endpoint: text('endpoint').primaryKey(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  zone: text('zone').notNull(),
  createdAt: createdAt(),
  lastSeenAt: text('last_seen_at').notNull(),
});

/** Notifications already sent, by key, so none goes out twice (even after a restart). Old ones are pruned. */
export const sentNotifications = sqliteTable('sent_notifications', {
  key: text('key').primaryKey(),
  sentAt: text('sent_at').notNull(),
});
