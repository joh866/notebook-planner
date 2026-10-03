import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDb } from './client';
import { seed } from './seed';
import * as t from './schema';

describe('seed', () => {
  it('loads the starting data from spec §16', () => {
    const db = openDb(':memory:');
    expect(seed(db)).toBe(true);

    expect(db.select().from(t.classes).all()).toHaveLength(4);
    // Morning, night, supplements, laundry, and the dorm (spec v0.5: meditate and gratitude are morning steps).
    expect(db.select().from(t.routines).all()).toHaveLength(5);
    expect(db.select().from(t.conditions).all()).toHaveLength(3);
    expect(db.select().from(t.tasks).all()).toHaveLength(18);

    const muq = db.select().from(t.tasks).where(eq(t.tasks.id, 'muqaddimah')).get();
    expect(muq?.dueAt).toBe('2026-10-06T19:00:00Z'); // 2pm Chicago, daylight time
    expect(muq?.sittingMinutes).toBe(75);
    expect(db.select().from(t.taskSteps).where(eq(t.taskSteps.taskId, 'muqaddimah')).all()).toHaveLength(3);

    const dorm = db.select().from(t.routines).where(eq(t.routines.id, 'dorm')).get();
    expect(dorm).toMatchObject({ repeat: 'weekly', repeatDays: [6], repeatEvery: 2, repeatFrom: '2026-10-03' });

    const fair = db.select().from(t.blocks).get();
    expect(fair).toMatchObject({ kind: 'event', title: 'RSO fair', startAt: '2026-10-02T20:00:00Z', pinned: true });

    const settings = db.select().from(t.settings).get();
    expect(settings).toMatchObject({ wakeTime: '09:00', bedTime: '00:00', autoSchedule: false, weekStart: 0, timeZone: 'auto' });
  });

  it('gives laundry steps with waiting time (spec §10)', () => {
    const db = openDb(':memory:');
    seed(db);
    const laundry = db.select().from(t.routines).where(eq(t.routines.id, 'laundry')).get();
    const steps = db.select().from(t.routineSteps).where(eq(t.routineSteps.routineId, 'laundry'))
      .orderBy(t.routineSteps.sortOrder).all();
    const total = (list: typeof steps) => list.reduce((sum, s) => sum + (s.minutes ?? 0), 0);

    expect(steps.map((s) => s.title)).toEqual(['Load the washer', 'Washing', 'Move to the dryer', 'Drying', 'Fold and put away']);
    expect(total(steps)).toBe(140);
    expect(laundry?.durationMinutes).toBe(140);
    expect(total(steps.filter((s) => s.waiting))).toBe(110);
    expect(total(steps.filter((s) => !s.waiting))).toBe(30);
  });

  it('uses the v0.4 routine lengths, Shopping run steps, and Epiphany split', () => {
    const db = openDb(':memory:');
    seed(db);
    const length = (id: string) => db.select().from(t.routines).where(eq(t.routines.id, id)).get()?.durationMinutes;
    const step = (id: string) => db.select().from(t.routineSteps).where(eq(t.routineSteps.id, id)).get()?.minutes;
    // Meditate and gratitude kept their v0.4 lengths as morning steps (spec v0.5).
    expect([step('morning-step-5'), step('morning-step-6'), length('dorm')]).toEqual([10, 5, 30]);

    const shopping = db.select().from(t.taskSteps).where(eq(t.taskSteps.taskId, 'shopping')).orderBy(t.taskSteps.sortOrder).all();
    expect(shopping.map((s) => s.title)).toEqual([
      'Ask roommates about the shower mat (cost, which one, who buys)', 'Small towels for the gym and bathroom', 'Razor', 'Shower mat',
    ]);
    expect(shopping.every((s) => !s.waiting && s.minutes === null)).toBe(true);

    const task = (id: string) => db.select().from(t.tasks).where(eq(t.tasks.id, id)).get();
    expect(task('epiphany')).toMatchObject({ window: 'week', sessionMinutes: 60 });
    expect(task('epiphany-build')).toMatchObject({
      window: 'decide', meta: 'Decide after going through it.',
      decisionYes: { makeTask: { title: 'Build a project based on Epiphany', window: 'soon' } },
    });
  });

  it('does nothing when data already exists', () => {
    const db = openDb(':memory:');
    seed(db);
    db.delete(t.tasks).where(eq(t.tasks.id, 'gym')).run();
    expect(seed(db)).toBe(false);
    expect(db.select().from(t.tasks).all()).toHaveLength(17);
  });

  it('cascades steps when a task is deleted', () => {
    const db = openDb(':memory:');
    seed(db);
    db.delete(t.tasks).where(eq(t.tasks.id, 'muqaddimah')).run();
    expect(db.select().from(t.taskSteps).where(eq(t.taskSteps.taskId, 'muqaddimah')).all()).toHaveLength(0);
  });
});
