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
  decisionYes: DecisionYesSchema.nullish(),
  doneAt: InstantSchema.nullish(),
  durationFeedback: DurationFeedbackSchema.nullish(),
  sortOrder: z.int().optional(),
});
export const TaskInputSchema = TaskFields.extend({ steps: z.array(StepInputSchema).optional() }).superRefine(rule(taskProblem));
export const TaskPatchSchema = TaskFields.partial();

const RoutineStepFields = z.strictObject({
  title: Title,
  minutes: Minutes.nullish(),
  waiting: z.boolean().optional(),
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
});
export const BlockInputSchema = BlockFields.superRefine(rule(blockProblem));
export const BlockPatchSchema = BlockFields.partial();

export const SometimeInputSchema = z.strictObject({ date: DaySchema, rolledFrom: DaySchema.nullish() });

const CategoryFields = z.strictObject({ name: Title, color: Color.nullish(), sortOrder: z.int().optional() });
export const CategoryInputSchema = CategoryFields;
export const CategoryPatchSchema = CategoryFields.partial();

const ConditionFields = z.strictObject({
  question: Title,
  snoozedUntil: DaySchema.nullish(),
  answeredAt: InstantSchema.nullish(),
});
export const ConditionInputSchema = ConditionFields;
export const ConditionPatchSchema = ConditionFields.partial();

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
  conditionId: string | null;
  decisionYes: DecisionYes | null;
  doneAt: string | null;
  steps: StepView[];
  /** The next time it's on the schedule from today on, or the day it's committed to. */
  scheduled: { startAt: string } | { sometime: string } | null;
}

export interface WaitingGroupView {
  condition: { id: string; question: string; snoozedUntil: string | null; answeredAt: string | null } | null;
  /** False after "Not yet" until the snooze ends, or once answered. */
  ask: boolean;
  tasks: TaskCard[];
}

export interface TaskGroupsView {
  overdue: TaskCard[];
  near: TaskCard[];
  week: TaskCard[];
  soon: TaskCard[];
  waiting: WaitingGroupView[];
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
  /** Task blocks only. */
  steps: StepView[];
  nextStep: string | null;
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
}

export interface DailyRow {
  routineId: string;
  title: string;
  categoryId: string | null;
  durationMinutes: number;
  checked: boolean;
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
  groups: TaskGroupsView;
  header: {
    overdue: { taskId: string; name: string }[];
    nextDeadline: { taskId: string; name: string; dueAt: string | null; dueDate: string | null } | null;
  };
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
