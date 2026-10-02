import { DateTime } from 'luxon';
import type { Db } from './client';
import * as t from './schema';

// Starting data from spec §16.

const HOME = 'America/Chicago';

/** A Chicago wall-clock moment as a UTC ISO string. */
const chicago = (date: string, time: string) =>
  DateTime.fromISO(`${date}T${time}`, { zone: HOME }).toUTC().toISO({ suppressMilliseconds: true })!;

const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6;

const categories: (typeof t.categories.$inferInsert)[] = [
  { id: 'class', name: 'Classes', builtin: true, sortOrder: 0 },
  { id: 'errand', name: 'Errands', builtin: true, sortOrder: 1 },
  { id: 'growth', name: 'Growth', builtin: true, sortOrder: 2 },
  { id: 'life', name: 'Life', builtin: true, sortOrder: 3 },
  { id: 'routine', name: 'Routines', builtin: true, sortOrder: 4 },
];

const classes: (typeof t.classes.$inferInsert)[] = [
  { id: 'econ-lec', code: 'ECON 20010', kind: 'Lecture', fullName: 'The Elements of Economic Analysis I Honors',
    days: [MON, WED], start: '11:00', end: '12:20', location: 'Saieh Hall for Economics 021', categoryId: 'class' },
  { id: 'econ-disc', code: 'ECON 20010', kind: 'Discussion', fullName: 'The Elements of Economic Analysis I Honors',
    days: [FRI], start: '13:30', end: '14:50', location: 'Saieh Hall for Economics 203', categoryId: 'class' },
  { id: 'math-lec', code: 'MATH 15910', kind: 'Lecture', fullName: 'Introduction to Proofs in Analysis',
    days: [MON, WED, FRI], start: '12:30', end: '13:20', location: 'Ryerson Phys Lab 255', categoryId: 'class' },
  { id: 'sosc-sem', code: 'SOSC 16100', kind: 'Seminar', fullName: 'Global Society I',
    days: [TUE, THU], start: '14:00', end: '15:20', location: 'Regenstein Library 207', categoryId: 'class' },
];

const routines: (typeof t.routines.$inferInsert)[] = [
  { id: 'morning', title: 'Morning routine', categoryId: 'routine', durationMinutes: 30, repeat: 'daily', sortOrder: 0 },
  { id: 'meditate', title: 'Meditate 10 min', categoryId: 'routine', durationMinutes: 10, repeat: 'daily', sortOrder: 1 },
  { id: 'gratitude', title: 'Gratitude, 5 things', categoryId: 'routine', durationMinutes: 5, repeat: 'daily', showStreak: true, sortOrder: 2 },
  { id: 'night', title: 'Night routine and journal', categoryId: 'routine', durationMinutes: 45, repeat: 'daily', sortOrder: 3 },
  { id: 'laundry', title: 'Laundry', categoryId: 'routine', durationMinutes: 140, repeat: 'weekly', repeatDays: [SAT], sortOrder: 4 },
  { id: 'dorm', title: 'Clean the dorm', categoryId: 'routine', durationMinutes: 30, repeat: 'weekly', repeatDays: [SAT],
    repeatEvery: 2, repeatFrom: '2026-10-03', sortOrder: 5 },
];

/** Laundry's steps with waiting time (spec §10). They add up to its 140 minutes. */
const routineSteps: (typeof t.routineSteps.$inferInsert)[] = [
  { title: 'Load the washer', minutes: 10 },
  { title: 'Washing', minutes: 55, waiting: true },
  { title: 'Move to the dryer', minutes: 5 },
  { title: 'Drying', minutes: 55, waiting: true },
  { title: 'Fold and put away', minutes: 15 },
].map((step, i) => ({ id: `laundry-step-${i + 1}`, routineId: 'laundry', sortOrder: i, ...step }));

const routineSlots: (typeof t.routineSlots.$inferInsert)[] = [
  { id: 'morning-slot', routineId: 'morning', start: '09:00', durationMinutes: 30 },
  { id: 'night-slot', routineId: 'night', start: '23:00', durationMinutes: 45 },
];

const conditions: (typeof t.conditions.$inferInsert)[] = [
  { id: 'cold', question: 'Is the cold fully gone?' },
  { id: 'arch', question: 'Did you get into ARCH?' },
  { id: 'qnet', question: 'Has the QNet certificate arrived?' },
];

type TaskSeed = typeof t.tasks.$inferInsert & { steps?: string[] };

const sosc = chicago('2026-10-06', '14:00');
const tasks: TaskSeed[] = [
  { id: 'muqaddimah', title: 'Read The Muqaddimah', shortName: 'the Muqaddimah reading', meta: 'SOSC 16100', categoryId: 'class',
    window: 'week', dueAt: sosc, estLow: 180, estHigh: 300, sittingMinutes: 75,
    steps: ['Chapter 2', 'Chapter 3, sections 1–15', 'Chapter 6, sections 34–37'] },
  { id: 'response', title: 'Prep for the reading response', shortName: 'the reading response', meta: 'SOSC 16100, go over likely prompts',
    categoryId: 'class', window: 'week', dueAt: sosc, estLow: 45, estHigh: 60 },
  { id: 'get-book', title: 'Get The Muqaddimah', meta: 'SOSC 16100, needed before the reading', categoryId: 'class',
    window: 'week', estLow: 20, estHigh: 40 },
  { id: 'math-pset', title: 'Problem Set 1', shortName: 'Math PSet 1', meta: 'MATH 15910', categoryId: 'class', window: 'week',
    dueAt: chicago('2026-10-07', '11:00'), estLow: 120, estHigh: 240, sittingMinutes: 90,
    steps: ['Do the problems', 'Check answers with a friend'] },
  { id: 'econ-pset', title: 'Problem Set 1', shortName: 'Econ PSet 1', meta: 'ECON 20010', categoryId: 'class', window: 'week',
    dueAt: chicago('2026-10-09', '12:00'), estLow: 120, estHigh: 180, sittingMinutes: 90 },
  { id: 'shopping', title: 'Shopping run', categoryId: 'errand', window: 'week', estLow: 45, estHigh: 75,
    steps: ['Ask roommates about the shower mat (cost, which one, who buys)', 'Small towels for the gym and bathroom', 'Razor',
      'Shower mat'] },
  { id: 'container', title: 'Clean the wooden container, store folders', categoryId: 'life', window: 'near', estLow: 20, estHigh: 40 },
  { id: 'quant', title: 'Consolidate the quant plan', meta: 'Or just start the stats course', categoryId: 'growth', window: 'near',
    estLow: 45, estHigh: 90 },

  { id: 'gym', title: 'Gym', categoryId: 'life', window: 'waiting', conditionId: 'cold', estLow: 60, estHigh: 90 },
  { id: 'boxing', title: 'Check out boxing club', categoryId: 'life', window: 'waiting', conditionId: 'cold' },
  { id: 'arch-reading', title: 'ARCH reading and photo upload', categoryId: 'class', window: 'waiting', conditionId: 'arch',
    estLow: 30, estHigh: 60 },
  { id: 'resume', title: 'Update resume, apply to internships', meta: 'Start with ones that skip the writing part',
    categoryId: 'growth', window: 'waiting', conditionId: 'qnet' },

  { id: 'blanket', title: 'New blanket?', categoryId: 'errand', window: 'decide',
    decisionYes: { makeTask: { title: 'Get a new blanket', window: 'soon' } } },
  { id: 'topper', title: 'Foam mattress topper?', categoryId: 'errand', window: 'decide',
    decisionYes: { makeTask: { title: 'Get a foam mattress topper', window: 'soon' } } },
  { id: 'skip-disc', title: 'Skip econ discussion Friday?', meta: 'Ask friends if they’re going', categoryId: 'class', window: 'decide',
    decisionYes: { skipClass: { classId: 'econ-disc', date: '2026-10-02' } } },
  { id: 'epiphany-build', title: 'Build my own project based on Epiphany?', meta: 'Decide after going through it.',
    categoryId: 'growth', window: 'decide',
    decisionYes: { makeTask: { title: 'Build a project based on Epiphany', window: 'soon' } } },

  { id: 'number-theory', title: 'Number theory book', categoryId: 'growth', window: 'ongoing', sessionMinutes: 45 },
  { id: 'epiphany', title: 'Go through the Epiphany ML project and understand it', categoryId: 'growth', window: 'week',
    sessionMinutes: 60 },
];

const blocks: (typeof t.blocks.$inferInsert)[] = [
  { id: 'rso-fair', kind: 'event', title: 'RSO fair', categoryId: 'life', startAt: chicago('2026-10-02', '15:00'), durationMinutes: 60 },
];

const defaultSettings: typeof t.settings.$inferInsert = {
  id: 1,
  notify: { classes: true, taskStarts: true, deadlines: true, morningSummary: true, planTomorrow: false, checkIns: false },
};

/** Loads the starting data. Does nothing if the database already has any data. Returns whether it seeded. */
export function seed(db: Db): boolean {
  return db.transaction((tx) => {
    const hasData = [t.settings, t.categories, t.tasks, t.routines, t.classes, t.blocks]
      .some((table) => tx.select().from(table).limit(1).all().length > 0);
    if (hasData) return false;

    tx.insert(t.settings).values(defaultSettings).run();
    tx.insert(t.categories).values(categories).run();
    tx.insert(t.classes).values(classes).run();
    tx.insert(t.routines).values(routines).run();
    tx.insert(t.routineSteps).values(routineSteps).run();
    tx.insert(t.routineSlots).values(routineSlots).run();
    tx.insert(t.conditions).values(conditions).run();
    tasks.forEach(({ steps, ...task }, i) => {
      tx.insert(t.tasks).values({ ...task, sortOrder: i }).run();
      steps?.forEach((title, j) => {
        tx.insert(t.taskSteps).values({ id: `${task.id}-step-${j + 1}`, taskId: task.id, title, sortOrder: j }).run();
      });
    });
    tx.insert(t.blocks).values(blocks).run();
    return true;
  });
}
