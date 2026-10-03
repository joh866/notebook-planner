import { z } from 'zod';
import { WindowSchema } from './schemas';

// What the add box's parser returns for each item (spec §11, "Output per item"). Both the AI and the
// local fallback produce this shape. The AI's reply is checked against it field by field: a field
// that doesn't fit is dropped instead of losing the whole item.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "7:00", "07:00", or "19:30" as "HH:mm". Anything else is dropped. */
const Clock = z.string().trim().transform((s, ctx) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    ctx.addIssue({ code: 'custom', message: 'Expected HH:mm' });
    return z.NEVER;
  }
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
});
const Day = z.string().trim().regex(DAY);
const Minutes = z.coerce.number().int().positive().max(7 * 24 * 60);
const Short = z.string().trim().min(1).max(500);

/** A field that's left out when it doesn't fit. */
const opt = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

export const ParsedStepSchema = z.union([
  Short.transform((title) => ({ title })),
  z.object({ title: Short, minutes: opt(Minutes), waiting: opt(z.boolean()) }),
]);
export type ParsedStep = { title: string; minutes?: number; waiting?: boolean };

export const ParsedItemSchema = z.object({
  type: z.enum(['task', 'routine', 'event', 'class']).catch('task'),
  title: Short,
  meta: opt(Short),
  cat: opt(Short),
  win: opt(WindowSchema),
  due: opt(z.object({ date: Day, time: opt(Clock.nullable()) })),
  short: opt(Short),
  est: opt(z.tuple([Minutes, Minutes]).transform(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number])),
  sitting: opt(Minutes),
  session: opt(Minutes),
  steps: opt(z.array(ParsedStepSchema.optional().catch(undefined)).transform((a) => a.filter((s): s is ParsedStep => !!s))),
  /** An "if" condition as it reads under the title ("if it's open"). */
  if: opt(Short),
  /** The check-in question for it ("Is it open?"). `wait` is the older name. */
  ask: opt(Short),
  wait: opt(Short),
  /** An "after" condition: an existing item's id, or the title of another item in the same text. */
  after: opt(Short),
  repeat: opt(z.object({
    days: z.union([z.literal('daily'), z.array(z.coerce.number().int().min(0).max(6)).min(1)]),
    every: opt(z.union([z.literal(1), z.literal(2)])),
  })),
  date: opt(Day),
  start: opt(Clock),
  end: opt(Clock),
  loc: opt(Short),
  tentative: opt(z.boolean()),
  /** For classes: "Lecture", "Discussion". */
  kind: opt(Short),
});
export type ParsedItem = z.output<typeof ParsedItemSchema>;

/** The items in a reply, dropping any that don't have a title. */
export function readItems(raw: unknown): ParsedItem[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.flatMap((x) => {
    const r = ParsedItemSchema.safeParse(x);
    return r.success ? [r.data] : [];
  });
}
