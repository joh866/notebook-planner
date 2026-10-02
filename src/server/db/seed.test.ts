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
    expect(db.select().from(t.routines).all()).toHaveLength(6);
    expect(db.select().from(t.conditions).all()).toHaveLength(3);
    expect(db.select().from(t.tasks).all()).toHaveLength(17);

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

  it('does nothing when data already exists', () => {
    const db = openDb(':memory:');
    seed(db);
    db.delete(t.tasks).where(eq(t.tasks.id, 'gym')).run();
    expect(seed(db)).toBe(false);
    expect(db.select().from(t.tasks).all()).toHaveLength(16);
  });

  it('cascades steps when a task is deleted', () => {
    const db = openDb(':memory:');
    seed(db);
    db.delete(t.tasks).where(eq(t.tasks.id, 'muqaddimah')).run();
    expect(db.select().from(t.taskSteps).where(eq(t.taskSteps.taskId, 'muqaddimah')).all()).toHaveLength(0);
  });
});
