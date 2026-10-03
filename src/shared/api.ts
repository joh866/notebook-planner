import { DateTime, IANAZone } from 'luxon';
import { z } from 'zod';
import {
  BlockKindSchema,
  DecisionYesSchema,
  DurationFeedbackSchema,
  LookSettingSchema,
  NotifySchema,
  WindowSchema,
  type BlockKind,
  type DecisionYes,
  type Notify,
  type Window,
} from './schemas';

// API inputs (validated on the server) and responses (spec §6–§10, §13).
// Storage conventions are in AGENTS.md: whole minutes, UTC ISO moments, local "HH:mm", "yyyy-MM-dd" days.

// ---------- Field shapes ----------

export const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-MM-dd')
  .refine((s) => DateTime.fromFormat(s, 'yyyy-MM-dd').isValid, 'Not a real day');

export const MonthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Expected yyyy-MM')
  .refine((s) => DateTime.fromFormat(s, 'yyyy-MM').isValid, 'Not a real month');

/** How many days an agenda read covers: up to six weeks, enough for a mini month. */
export const AgendaDaysSchema = z.coerce.number().int().min(1).max(42);

export const ClockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');

/** Any ISO moment with an offset, stored as UTC ("2026-10-06T19:00:00Z"). */
export const InstantSchema = z.iso
  .datetime({ offset: true })
  .transform((s) => DateTime.fromISO(s, { setZone: true }).toUTC().toISO({ suppressMilliseconds: true })!);

export const ZoneSchema = z.string().refine((s) => IANAZone.isValidZone(s), 'Not a time zone');

const Id = z.string().min(1).max(200);
const Title = z.string().trim().min(1).max(500);
const Text = z.string().max(10_000);
const Minutes = z.int().positive().max(7 * 24 * 60);
const Weekdays = z.array(z.int().min(0).max(6)).min(1).transform((d) => [...new Set(d)].sort());
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #rrggbb');

// ---------- Rules that span fields ----------
// Checked on create, and on the merged row after a partial update.

type Problem = string | null;

export function taskProblem(t: { dueAt?: string | null; dueDate?: string | null; estLow?: number | null; estHigh?: number | null }): Problem {
  if (t.dueAt && t.dueDate) return 'A deadline is a moment (dueAt) or a day (dueDate), not both';
  if (t.estLow != null && t.estHigh != null && t.estLow > t.estHigh) return 'estLow is more than estHigh';
  return null;
}

export function routineProblem(r: { repeat?: string; repeatDays?: number[] | null; repeatEvery?: number | null; repeatFrom?: string | null }): Problem {
  if (r.repeat === 'weekly' && !r.repeatDays?.length) return 'Weekly routines need repeatDays';
  if ((r.repeatEvery ?? 1) > 1 && !r.repeatFrom) return 'Every other week needs repeatFrom';
  return null;
}

export function classProblem(c: { start?: string; end?: string }): Problem {
  return c.start && c.end && c.end <= c.start ? 'A class must end after it starts' : null;
}

export function blockProblem(b: { kind?: string; taskId?: string | null; title?: string | null }): Problem {
  if (b.kind === 'task' && !b.taskId) return 'Task blocks need a taskId';
  if (b.kind === 'event' && !b.title) return 'Events need a title';
  return null;
}

const rule = <T>(check: (v: T) => Problem) => (v: T, ctx: z.RefinementCtx) => {
  const message = check(v);
  if (message) ctx.addIssue({ code: 'custom', message });
};

// ---------- Inputs ----------

export const StepInputSchema = z.strictObject({
  title: Title,
  minutes: Minutes.nullish(),
  waiting: z.boolean().optional(),
  done: z.boolean().optional(),
  sortOrder: z.int().optional(),
});
export const StepPatchSchema = StepInputSchema.partial();

const TaskFields = z.strictObject({
  title: Title,
  meta: Text.nullish(),
  notes: Text.nullish(),
  categoryId: Id.nullish(),
  window: WindowSchema,
  dueAt: InstantSchema.nullish(),
  dueDate: DaySchema.nullish(),
  shortName: Title.nullish(),
  estLow: Minutes.nullish(),
  estHigh: Minutes.nullish(),
  sittingMinutes: Minutes.nullish(),
  sessionMinutes: Minutes.nullish(),
  conditionId: Id.nullish(),
  afterTaskId: Id.nullish(),
  afterBlockId: Id.nullish(),
  decisionYes: DecisionYesSchema.nullish(),
  doneAt: InstantSchema.nullish(),
  durationFeedback: DurationFeedbackSchema.nullish(),
  quick: z.boolean().optional(),
  sortOrder: z.int().optional(),
});
export const TaskInputSchema = TaskFields.extend({ steps: z.array(StepInputSchema).optional() }).superRefine(rule(taskProblem));
export const TaskPatchSchema = TaskFields.partial();

const RoutineStepFields = z.strictObject({
  title: Title,
  minutes: Minutes.nullish(),
  waiting: z.boolean().optional(),
  showStreak: z.boolean().optional(),
  sortOrder: z.int().optional(),
});
export const RoutineStepInputSchema = RoutineStepFields;
export const RoutineStepPatchSchema = RoutineStepFields.partial();

export const SlotInputSchema = z.strictObject({ start: ClockSchema, durationMinutes: Minutes.optional() });
export const SlotPatchSchema = z.strictObject({ start: ClockSchema, durationMinutes: Minutes }).partial();

/** One day's change to a routine slot. */
export const SlotExceptionInputSchema = z.strictObject({
  skipped: z.boolean().optional(),
  start: ClockSchema.nullish(),
  durationMinutes: Minutes.nullish(),
});

const RoutineFields = z.strictObject({
  title: Title,
  categoryId: Id.nullish(),
  durationMinutes: Minutes,
  repeat: z.enum(['daily', 'weekly']),
  repeatDays: Weekdays.nullish(),
  repeatEvery: z.int().min(1).max(2).optional(),
  repeatFrom: DaySchema.nullish(),
  showStreak: z.boolean().optional(),
  sortOrder: z.int().optional(),
});
export const RoutineInputSchema = RoutineFields.extend({
  steps: z.array(RoutineStepInputSchema).optional(),
  slots: z.array(SlotInputSchema).optional(),
}).superRefine(rule(routineProblem));
export const RoutinePatchSchema = RoutineFields.partial();

const ClassFields = z.strictObject({
  code: Title,
  kind: Title,
  fullName: Title.nullish(),
  days: Weekdays,
  start: ClockSchema,
  end: ClockSchema,
  timeZone: ZoneSchema.optional(),
  location: Title.nullish(),
  categoryId: Id.nullish(),
});
export const ClassInputSchema = ClassFields.superRefine(rule(classProblem));
export const ClassPatchSchema = ClassFields.partial();

const BlockFields = z.strictObject({
  kind: BlockKindSchema,
  title: Title.nullish(),
  categoryId: Id.nullish(),
  taskId: Id.nullish(),
  startAt: InstantSchema,
  durationMinutes: Minutes,
  tentative: z.boolean().optional(),
  label: Title.nullish(),
  location: Title.nullish(),
  pinned: z.boolean().optional(),
  reason: Title.nullish(),
  rolledFrom: DaySchema.nullish(),
  done: z.boolean().optional(),
  conditionId: Id.nullish(),
  afterTaskId: Id.nullish(),
  afterBlockId: Id.nullish(),
});
export const BlockInputSchema = BlockFields.superRefine(rule(blockProblem));
export const BlockPatchSchema = BlockFields.partial();

export const SometimeInputSchema = z.strictObject({ date: DaySchema, rolledFrom: DaySchema.nullish() });

const CategoryFields = z.strictObject({ name: Title, color: Color.nullish(), sortOrder: z.int().optional() });
export const CategoryInputSchema = CategoryFields;
export const CategoryPatchSchema = CategoryFields.partial();

const ConditionFields = z.strictObject({
  question: Title,
  phrase: Title.nullish(),
  snoozedUntil: DaySchema.nullish(),
  answeredAt: InstantSchema.nullish(),
});
export const ConditionInputSchema = ConditionFields;
export const ConditionPatchSchema = ConditionFields.partial();

/** Yes or No on a decision item (spec §10), and on "Still on?" for a timed "if" item. */
export const DecideInputSchema = z.strictObject({ yes: z.boolean() });

/** A spot on a day's schedule, in wall-clock minutes after midnight (6am to 3am the next night). */
const DayMinute = z.int().min(6 * 60).max(27 * 60);

/**
 * Drag and drop (spec §10). Each drop is one change with one Undo. Positions are minutes on `date`
 * as shown in the device's zone (`?tz=`); the server turns them into moments or local clock times.
 * Drops onto the task panel use the plain deletes (blocks, routine slots, Sometime entries).
 */
export const DropInputSchema = z.discriminatedUnion('action', [
  /** A task card or Sometime chip onto the schedule: a new pinned block. */
  z.strictObject({ action: z.literal('placeTask'), taskId: Id, date: DaySchema, startMin: DayMinute }),
  /** A task card, chip, or task block onto the Sometime lane. A dragged block comes off the schedule. */
  z.strictObject({ action: z.literal('commitTask'), taskId: Id, date: DaySchema, blockId: Id.optional() }),
  /** A task, event, or open-time block to a new time. It becomes pinned. */
  z.strictObject({ action: z.literal('moveBlock'), blockId: Id, date: DaySchema, startMin: DayMinute, label: Title.nullish() }),
  /** A routine block to a new time, for this day only or every day. */
  z.strictObject({ action: z.literal('moveRoutine'), slotId: Id, date: DaySchema, startMin: DayMinute, everyDay: z.boolean().optional() }),
  /** A Daily checklist row onto the schedule: it repeats at that time. */
  z.strictObject({ action: z.literal('placeRoutine'), routineId: Id, date: DaySchema, startMin: DayMinute }),
  /** A block's new length. */
  z.strictObject({ action: z.literal('resizeBlock'), blockId: Id, minutes: Minutes }),
  /** A routine block's new length, for this day only or every day. */
  z.strictObject({ action: z.literal('resizeRoutine'), slotId: Id, date: DaySchema, minutes: Minutes, everyDay: z.boolean().optional() }),
  /** A quick task onto a "Quick things" block: it joins the batch (spec §10). */
  z.strictObject({ action: z.literal('joinBatch'), taskId: Id, blockId: Id }),
  /** A task dragged out of a "Quick things" block back to the list. */
  z.strictObject({ action: z.literal('leaveBatch'), taskId: Id, blockId: Id }),
]);
export type DropInput = z.infer<typeof DropInputSchema>;

/** Time spent on a task (spec §10): a start, and an end or a length. `done` finishes the task too. */
export const LogInputSchema = z.strictObject({
  startAt: InstantSchema,
  endAt: InstantSchema.optional(),
  minutes: Minutes.optional(),
  done: z.boolean().optional(),
}).refine((x) => x.endAt || x.minutes, 'Give an end or a length');
export const StopInputSchema = z.strictObject({ done: z.boolean().optional() });
export const SessionPatchSchema = z.strictObject({ startAt: InstantSchema.optional(), endAt: InstantSchema.nullish() });

export interface SessionView {
  id: string;
  taskId: string;
  startAt: string;
  /** Null while it's running. */
  endAt: string | null;
}

/** What reporting time did, so the message can list every change (spec §10). */
export interface LogResult {
  taskId: string;
  title: string;
  session: SessionView;
  minutes: number;
  done: boolean;
  /** Where its block moved, when it was finished. */
  block: { id: string; startAt: string; endAt: string } | null;
  /** Events that now end when you switched. */
  trimmed: { id: string; title: string; endAt: string }[];
}

/** GET /api/time-log: a finished task with its estimate and actual time. */
export interface TimeLogEntry {
  taskId: string;
  title: string;
  categoryId: string | null;
  doneAt: string;
  estLow: number | null;
  estHigh: number | null;
  /** Null when no time was recorded. */
  actualMinutes: number | null;
  durationFeedback: 'as_planned' | 'longer' | 'shorter' | null;
  sessions: SessionView[];
}

/** The add box (spec §11): anything from one line to a whole pasted list. */
export const AddInputSchema = z.strictObject({ text: z.string().trim().min(1).max(50_000) });

export const SettingsPatchSchema = z.strictObject({
  wakeTime: ClockSchema,
  bedTime: ClockSchema,
  look: LookSettingSchema,
  timeZone: z.union([z.literal('auto'), ZoneSchema]),
  homeTimeZone: ZoneSchema,
  autoSchedule: z.boolean(),
  weekStart: z.union([z.literal(0), z.literal(1)]),
  notify: NotifySchema.partial(),
  canvasFeedUrl: z.url().nullable(),
}).partial();

// ---------- Responses ----------

/** Every change returns a token for POST /api/undo/:token. */
export interface Changed<T = undefined> {
  item: T;
  undo: string | null;
}

/** POST /api/tasks/:id/decide. The decision is dropped either way. */
export interface DecisionResult {
  /** The task Yes made, if any. */
  made: { id: string; title: string; window: Window } | null;
  /** The class Yes skipped, keyed by its Chicago day. */
  skipped: { classId: string; date: string } | null;
}

/** POST /api/conditions/:id/answer. The tasks and events whose condition Yes cleared. */
export interface ConditionAnswer {
  cleared: { id: string; title: string }[];
}

/** POST /api/tasks/:id/still-on and /api/blocks/:id/still-on. Yes makes it a normal item; No removes it. */
export interface StillOnResult {
  removed: boolean;
}

/** POST /api/drops. `routine` is set for placeRoutine, so the message can say how it repeats. */
export interface DropResult {
  routine: { title: string; repeat: 'daily' | 'weekly'; repeatDays: number[] | null; repeatEvery: number; start: string } | null;
}

export interface CapacityView {
  level: 'heads-up' | 'tight';
  /** Minutes of work due by the deadline, and of free time before it. */
  work: number;
  free: number;
  dueAt: string | null;
  dueDate: string | null;
}

/** POST /api/plan (spec §12). Penciled blocks for the rest of the day were lifted, then these placed. */
export interface PlanResult {
  date: string;
  placed: { taskId: string; title: string; startAt: string; reason: string }[];
  lifted: number;
  /** Free minutes left on the day before planning, to say why nothing fit. */
  free: number;
}

export const PlanInputSchema = z.strictObject({ date: DaySchema });

/** One thing the add box made, for the result message. */
export type AddedItem =
  /** `penciled` is the block's start when automatic scheduling placed it. */
  | { kind: 'task'; id: string; title: string; window: Window | 'overdue'; penciled?: string | null }
  /** An event with no time: a task in that day's Sometime lane. */
  | { kind: 'sometime'; id: string; title: string; date: string }
  | { kind: 'event'; id: string; title: string; date: string; startAt: string }
  | { kind: 'routine'; id: string; title: string }
  | { kind: 'class'; id: string; title: string };

/** A change the add box made to something that already existed (spec §11). */
export type ChangeDone =
  | { action: 'done' | 'delete' | 'update' | 'move' | 'checkStep'; kind: 'task' | 'routine' | 'event' | 'step'; id: string; title: string; detail: string | null }
  /** Time reported for a task, with what it moved and trimmed. */
  | { action: 'log'; kind: 'task'; id: string; title: string; detail: null; log: LogResult };

/** When it's unclear which item is meant, nothing changes and the message asks (spec §11). */
export interface AddQuestion {
  prompt: string;
  options: { id: string; title: string }[];
  /** The change to make with the chosen id: POST /api/changes. */
  change: Record<string, unknown>;
}

/** A check-in question the text seems to answer: the message offers Yes (spec §11). */
export interface CheckInOffer {
  conditionId: string;
  question: string;
}

/** POST /api/add. */
export interface AddResult {
  added: AddedItem[];
  /** How many chunks the text was split into, and how many fell back to the local guess. */
  chunks: number;
  fellBack: number;
  /** Why the first failed chunk failed. */
  reason: string | null;
  changes: ChangeDone[];
  questions: AddQuestion[];
  offers: CheckInOffer[];
  /** Words for items it couldn't find. */
  missing: string[];
}

/** POST /api/changes: one change, with the id picked from a question's buttons. */
export const ChangeInputSchema = z.strictObject({ change: z.record(z.string(), z.unknown()), id: z.string().min(1).max(200) });
export interface ChangesResult {
  changes: ChangeDone[];
  questions: AddQuestion[];
  missing: string[];
}

export interface StepView {
  id: string;
  title: string;
  minutes: number | null;
  waiting: boolean;
  done: boolean;
}

export interface TaskCard {
  id: string;
  title: string;
  meta: string | null;
  notes: string | null;
  categoryId: string | null;
  window: Window;
  /** The group it shows in (spec §10, "Urgency rises"). */
  effectiveWindow: Window | 'overdue' | 'done';
  dueAt: string | null;
  dueDate: string | null;
  dueTone: 'plain' | 'soon' | 'urgent' | 'overdue' | null;
  shortName: string | null;
  estLow: number | null;
  estHigh: number | null;
  sittingMinutes: number | null;
  sessionMinutes: number | null;
  /** 15 minutes or less, or marked quick: it can go in a "Quick things" block (spec §10). */
  quick: boolean;
  /** Its running session, if Start was pressed. */
  running: { sessionId: string; startAt: string } | null;
  /** Minutes recorded so far (spec §10, "Partial progress"). */
  loggedMinutes: number;
  conditionId: string | null;
  /** Its "if" or "after" condition while it holds, shown in look C (spec §10, "Conditions"). */
  condition: ConditionView | null;
  decisionYes: DecisionYes | null;
  doneAt: string | null;
  steps: StepView[];
  /** The next time it's on the schedule from today on, or the day it's committed to. */
  scheduled: { startAt: string } | { sometime: string } | null;
}

/** A condition that still holds: an unanswered "if" question, or an "after" whose prerequisite isn't done. */
export type ConditionView =
  | { kind: 'if'; conditionId: string; question: string; text: string }
  | { kind: 'after'; taskId: string | null; blockId: string | null; title: string; text: string };

/** An unanswered check-in question for the strip at the top of the task panel (spec §9). */
export interface CheckInView {
  conditionId: string;
  question: string;
  /** What's waiting on it. */
  titles: string[];
}

export interface TaskGroupsView {
  overdue: TaskCard[];
  near: TaskCard[];
  week: TaskCard[];
  soon: TaskCard[];
  decide: TaskCard[];
  ongoing: TaskCard[];
  done: TaskCard[];
}

/** Positions on the day, in wall-clock minutes after that day's midnight. Past midnight runs over 1440. */
interface Placed {
  startAt: string;
  startMin: number;
  endMin: number;
}

export interface ClassItem extends Placed {
  type: 'class';
  /** "classId@homeDate". */
  id: string;
  classId: string;
  /** The class's own (Chicago) day. Skips are recorded against it. */
  homeDate: string;
  code: string;
  kind: string;
  fullName: string | null;
  location: string | null;
  categoryId: string | null;
  skipped: boolean;
}

export interface RoutineStepView {
  id: string;
  title: string;
  minutes: number | null;
  waiting: boolean;
  checked: boolean;
  /** Days in a row, for a step with a streak (gratitude). */
  streak: number | null;
}

export interface RoutineItem extends Placed {
  type: 'routine';
  /** "slotId@date". */
  id: string;
  slotId: string;
  routineId: string;
  title: string;
  categoryId: string | null;
  /** Local "HH:mm". */
  start: string;
  durationMinutes: number;
  /** Moved or resized for this day only. */
  changed: boolean;
  checked: boolean;
  steps: RoutineStepView[];
}

export interface BlockItem extends Placed {
  type: 'block';
  id: string;
  kind: BlockKind;
  title: string | null;
  categoryId: string | null;
  taskId: string | null;
  durationMinutes: number;
  tentative: boolean;
  label: string | null;
  location: string | null;
  pinned: boolean;
  reason: string | null;
  rolledFrom: string | null;
  done: boolean;
  /** A task block whose time has passed today while it's unchecked. */
  missed: boolean;
  /** Its condition (a task block's comes from its task), while it holds. */
  condition: ConditionView | null;
  /** A timed "if" item whose time has come: it asks "Still on?" (spec §7). */
  askNow: boolean;
  /** Task blocks only. */
  steps: StepView[];
  nextStep: string | null;
  /** The tasks in a "Quick things" block (spec §10). Empty for other blocks. */
  items: QuickItemView[];
  /** A logged block shows actual time: its length and the estimate it had (spec §7). */
  logged: { minutes: number; estimate: number | null } | null;
  /** Its task's session is running. */
  running: boolean;
}

export interface QuickItemView {
  taskId: string;
  title: string;
  categoryId: string | null;
  done: boolean;
  /** How long it takes inside the batch. */
  minutes: number;
}

export type ScheduleItem = ClassItem | RoutineItem | BlockItem;

export interface DeadlineView {
  taskId: string;
  /** shortName, or the title. */
  name: string;
  dueAt: string | null;
  dueDate: string | null;
  /** Null for day-only deadlines. */
  atMin: number | null;
  done: boolean;
}

export interface SometimeView {
  taskId: string;
  title: string;
  categoryId: string | null;
  done: boolean;
  rolledFrom: string | null;
  /** How long its block is when it goes on the schedule (spec §12). */
  minutes: number;
  /** It's here because it's due that day (a day-only deadline), not because it was picked for the day. */
  due: boolean;
}

export interface DailyRow {
  routineId: string;
  title: string;
  categoryId: string | null;
  durationMinutes: number;
  checked: boolean;
  /** Its time on the schedule is skipped for this day. */
  skipped: boolean;
  /** Only for routines that show one. */
  streak: number | null;
  /** Local "HH:mm" when it's on the schedule that day. */
  time: string | null;
  steps: RoutineStepView[];
}

export interface DaySchedule {
  date: string;
  schedule: ScheduleItem[];
  deadlines: DeadlineView[];
  sometime: SometimeView[];
}

interface ViewContext {
  /** The zone everything is shown in. */
  zone: string;
  homeZone: string;
  /** UTC ISO. */
  now: string;
  today: string;
}

export interface DayView extends ViewContext, DaySchedule {
  daily: DailyRow[];
  /** Unanswered check-in questions, not snoozed (spec §9, "Check-ins"). */
  checkIns: CheckInView[];
  groups: TaskGroupsView;
  header: {
    overdue: { taskId: string; name: string }[];
    nextDeadline: { taskId: string; name: string; dueAt: string | null; dueDate: string | null } | null;
  };
  /** The names of every unfinished task due at the next deadline's moment. A class is never one (spec §6). */
  nextDeadlineNames: string[];
  /** The capacity warning under the header (spec §6), when the work due soon is more than half the free time before it. */
  capacity: CapacityView | null;
}

export interface WeekView extends ViewContext {
  start: string;
  days: DaySchedule[];
}

export interface MonthDay {
  date: string;
  deadlines: DeadlineView[];
  events: BlockItem[];
  /** Weekly routines that fall on the day. */
  chores: { routineId: string; title: string; categoryId: string | null }[];
  skippedClasses: ClassItem[];
}

export interface MonthView extends ViewContext {
  month: string;
  weekStart: number;
  days: MonthDay[];
}

/** GET /api/agenda/:date?days=N. Consecutive days from `from`. */
export interface AgendaView extends ViewContext {
  from: string;
  days: MonthDay[];
}

/** GET /api/settings. */
export interface SettingsView {
  wakeTime: string;
  bedTime: string;
  look: 'auto' | 'day' | 'night';
  timeZone: string;
  homeTimeZone: string;
  autoSchedule: boolean;
  weekStart: number;
  notify: Notify;
  canvasFeedUrl: string | null;
}

/** GET /api/categories. Built-ins have no color; they use the palette in spec §4. */
export interface CategoryView {
  id: string;
  name: string;
  color: string | null;
  builtin: boolean;
  sortOrder: number;
}
