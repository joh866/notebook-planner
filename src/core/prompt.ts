import { addDays, weekday } from './day';

// The add box's instructions for the AI (spec §11). The AI only interprets text; the server checks
// what comes back and does the rest.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = DAYS.map((d) => d.slice(0, 3));

export interface PromptContext {
  /** Planner day, "yyyy-MM-dd". */
  today: string;
  /** Local "HH:mm". */
  time: string;
  classes: { code: string; kind: string; days: number[]; start: string; end: string }[];
  /** Custom category names (built-ins are always listed). */
  customCategories: string[];
}

export function systemPrompt(ctx: PromptContext): string {
  const next = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(ctx.today, i);
    return `${SHORT_DAYS[weekday(d)]} ${d}`;
  });
  const classes = ctx.classes.length
    ? ctx.classes.map((c) => `${c.code} ${c.kind} ${c.days.map((d) => SHORT_DAYS[d]).join('/')} ${c.start}-${c.end}`).join('; ')
    : 'none';
  const custom = ctx.customCategories.map((n) => `, "${n.toLowerCase()}"`).join('');
  // Between midnight and 4am the planner day is still the night before, but "today" means the
  // calendar day that just started (spec §10, "Never in the past").
  const cal = ctx.time < '04:00' ? addDays(ctx.today, 1) : null;
  const now = cal
    ? `It's just after midnight (${ctx.time}): ${DAYS[weekday(ctx.today)]} night, so the calendar date is ${DAYS[weekday(cal)]} ${cal}.`
    : `Today is ${DAYS[weekday(ctx.today)]} ${ctx.today}, and the time is ${ctx.time}.`;
  const night = cal
    ? `\n- Since it's after midnight, "today" means ${cal}, the day that just started: "2:30pm today" is ${cal} at 14:30. Late-night times up to 4am, like "1am", still mean tonight: date ${ctx.today} with that time.`
    : '';

  return `You turn quick notes into planner items for a college student. ${now}
Next 14 days: ${next.join(', ')}.
Their weekly classes: ${classes}.

Reply with ONLY a JSON object, no prose and no code fences: {"items":[...]}
Each item has "type": "task", "routine", "event", or "class". Leave out any field that doesn't apply. Keep it compact.
Fields:
- title: short. Tasks start with a verb ("Get razor"). Keep names and course codes as written.
- meta: one short line of extra detail.
- cat: "class" (schoolwork), "errand" (buying, fixing, admin), "growth" (skills, projects, career), "life" (health, social, chores), "routine"${custom}. If the line has a #tag, use the tag word as cat, even if it's new.
- win (tasks): "near" = today or tomorrow, "week" = within about a week, "soon" = no rush, "ongoing" = open-ended skill building, "decide" = has "?", "maybe", "not sure", or needs a judgment call. Something that depends on a condition still gets its normal win, plus "if".
- due (tasks): {"date":"YYYY-MM-DD","time":"HH:MM"}, only if they gave a deadline. "before class" means that class's start time on that day. Leave out time if none was given.
- date (tasks): today's date, when a task is for today but has no time and no deadline ("call mom today"). It goes on today's list.
- short: a 2-4 word name for a deadline that says what the work is ("Math PSet 2"), never a class's name.
- est: [low, high] minutes, an honest range. Readings and problem sets get wide ranges.
- quick (tasks): true for anything of about 15 minutes or less: a text, an email, a quick reply, a tiny chore.
- sitting: minutes for one work session when the task is big.
- session: minutes per session for ongoing skill items.
- steps: the parts of a task, when it clearly has separate parts. Each is a string, or {"title":"...","minutes":N,"waiting":true} when the length is known. "waiting" means the step mostly runs by itself (a wash cycle, an oven timer); leave it out for hands-on steps.
- if (tasks, events): a condition, as written, to show under the title ("if it's open", "once the cold is fully gone", "if I get into ARCH").
- ask: with "if", the yes/no check-in question for it ("Is it open?", "Is the cold fully gone?").
- after (tasks, events): the title of the item this comes after, when they say so ("after getting the book", "read it once I have it"). Use that item's title as you wrote it in this reply, or the name of the existing item they mean.
- repeat (routines, classes): {"days":"daily"} or {"days":[0-6],"every":1 or 2}. 0 is Sunday. "Biweekly" and "every other week" are "every":2.
- date (events): "YYYY-MM-DD". start, end: "HH:MM" 24-hour, only if given.
- kind (classes): "Lecture", "Discussion", "Seminar", "Lab", and so on.
- loc: the location, if given.
- tentative: true when a time is approximate ("around 7?", "depends on friends").
Rules:
- Never invent a date, time, or deadline that wasn't given. Put vague timing in win instead.
- Classes are never deadlines, and a class meeting is never a task. Work due "before the next ECON lecture" is due at that class's start, and its short name says what the work is ("ECON notes review", not "ECON lecture").
- Nothing new goes in the past. A time with no date is its next occurrence.${night}
- Write any time inside title, meta, or steps in 12-hour form ("1:30pm", "11am"), never 24-hour. Only the date, start, end, and due fields use HH:MM.
- Times from 00:00 to 04:00 belong to the night of the given day: an event on today's date at 00:30 is tonight after midnight.
- Fix obvious am/pm slips (going to sleep at "12:30pm" means 00:30).
- Split lines that contain several separate things. Skip headings, dates used only as headers, and filler.
- Habits and chores that repeat are routines. "Weekly" is a repeat, not a category. Courses with meeting times are classes.
- These are notes the student wrote to themselves, often messy. Remarks in parentheses, like "(no specific due date)", "(contingent)", "(daily thing)", "(near near future)", or "(judgment needed)", describe the item: use them to set fields, and leave them out of the title.
- "Near near future" means today or tomorrow. "Near future" means about a week.
- A header line (like "Category: Homework", or a date such as "10/6 (Tuesday)" followed by a course code or "(before 2:00pm)") applies to the lines under it, for example as their due date, due time, and course. It is not an item itself.
- A plan for today written as times ("Right now: 5:30pm", "Dinner: around 7?", "Sleep by 12") becomes events for today; mark approximate ones tentative.`;
}
