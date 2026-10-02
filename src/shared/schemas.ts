import { z } from 'zod';

export const HealthSchema = z.object({ ok: z.literal(true) });
export type Health = z.infer<typeof HealthSchema>;

/** Where a task sits in the list (spec §9, §11). Overdue is derived, never stored. */
export const WindowSchema = z.enum(['near', 'week', 'soon', 'ongoing', 'waiting', 'decide']);
export type Window = z.infer<typeof WindowSchema>;

/** One-off blocks on the schedule (spec §7). */
export const BlockKindSchema = z.enum(['event', 'open', 'task']);
export type BlockKind = z.infer<typeof BlockKindSchema>;

export const LookSettingSchema = z.enum(['auto', 'day', 'night']);

/** Answer to "How long did it take?" (spec §10). */
export const DurationFeedbackSchema = z.enum(['as_planned', 'longer', 'shorter']);

/** What "Yes" does for a decision item (spec §10). */
export const DecisionYesSchema = z.union([
  z.object({ makeTask: z.object({ title: z.string(), window: WindowSchema }) }),
  z.object({ skipClass: z.object({ classId: z.string(), date: z.string() }) }),
]);
export type DecisionYes = z.infer<typeof DecisionYesSchema>;

export const NotifySchema = z.object({
  classes: z.boolean(),
  taskStarts: z.boolean(),
  deadlines: z.boolean(),
  morningSummary: z.boolean(),
  planTomorrow: z.boolean(),
  checkIns: z.boolean(),
});
export type Notify = z.infer<typeof NotifySchema>;
