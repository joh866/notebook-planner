import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AddResult, BlockItem, ChangesResult, DayView } from '../shared/api';
import { addMessage } from '../web/addMessage';
import type { SortChunk, SortReply } from './ai';
import { createApp } from './app';
import { openDb, type Db } from './db/client';
import { seed } from './db/seed';
import * as t from './db/schema';

// The add box makes changes and plans days (spec §11). Replies are recorded, so there's no network.

const CHI = 'America/Chicago';
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../tests/fixtures/${name}`, import.meta.url)), 'utf8');
const lines = fixture('notes-oct-9.txt').trim().split('\n');
const recorded = JSON.parse(fixture('notes-oct-9.replies.json')) as Record<string, Partial<SortReply>>;
const LABELS = { overdue: 'Overdue', near: 'Today or tomorrow', week: 'This week', soon: 'Soon', decide: 'Needs a decision', ongoing: 'Ongoing' };

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: DateTime;
let reply: (chunk: string) => Partial<SortReply>;
let prompts: string[];

beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
  prompts = [];
  reply = (chunk) => recorded[chunk.trim()] ?? {};
  const sort: SortChunk = async (system, chunk) => {
    prompts.push(system);
    const r = reply(chunk);
    return { items: r.items ?? [], changes: r.changes ?? [], answers: r.answers ?? [] };
  };
  app = createApp({ db, now: () => clock, sort });
});

async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}
const add = (text: string) => call<{ item: AddResult; undo: string }>('POST', `/api/add?tz=${CHI}`, { text }).then((r) => r.body);
const day = async (date: string) => (await call<DayView>('GET', `/api/day/${date}?tz=${CHI}`)).body;
const blocks = (d: DayView) => d.schedule.filter((x): x is BlockItem => x.type === 'block');
const task = (id: string) => db.select().from(t.tasks).all().find((x) => x.id === id)!;

describe('notes from Oct 9 (tests/fixtures/notes-oct-9.txt)', () => {
  it('“sosc reading done (82 minutes starting at 3:46pm)” logs it, moves its block, and ends the RSO fair', async () => {
    clock = DateTime.fromISO('2026-10-02T17:30', { zone: CHI });
    const r = await add(lines[0]!);
    expect(r.item.added).toEqual([]);
    expect(r.item.changes).toHaveLength(1);
    expect(addMessage(r.item, '2026-10-02', CHI, LABELS))
      .toBe('Marked “Read The Muqaddimah” done, 3:46–5:08pm (82 min). Ended RSO fair at 3:46pm. Sorted by AI.');
    const d = await day('2026-10-02');
    expect(blocks(d).find((b) => b.taskId === 'muqaddimah')).toMatchObject({ startMin: 946, endMin: 1028, done: true, logged: { minutes: 82 } });
    expect(blocks(d).find((b) => b.id === 'rso-fair')).toMatchObject({ endMin: 946 });

    // One Undo covers all of it.
    await call('POST', `/api/undo/${r.undo}`);
    expect(task('muqaddimah').doneAt).toBeNull();
    expect(blocks(await day('2026-10-02')).find((b) => b.id === 'rso-fair')?.endMin).toBe(960);
  });

  it('the day plan becomes the MTG event, the go club right after it if it’s open, and the gym at about 4', async () => {
    clock = DateTime.fromISO('2026-10-03T10:00', { zone: CHI });
    const r = await add(lines[1]!);
    expect(r.item.added.map((a) => a.title)).toEqual(['MTG event', 'Stop by Go club', 'Gym with friends']);
    const d = await day('2026-10-03');
    const events = blocks(d).filter((b) => b.kind === 'event');
    const mtg = events.find((b) => b.title === 'MTG event')!;
    const go = events.find((b) => b.title === 'Stop by Go club')!;
    const gym = events.find((b) => b.title === 'Gym with friends')!;
    expect(mtg).toMatchObject({ startMin: 13 * 60 + 15, endMin: 14 * 60 + 15, tentative: true, location: 'Crerar Library', label: 'Around 1:15pm, preferably before 1:30pm' });
    expect(go).toMatchObject({ startMin: 14 * 60 + 15, endMin: 14 * 60 + 45, condition: { kind: 'if', text: "if it's open", question: 'Is the Go club open?' } });
    expect(db.select().from(t.blocks).all().find((b) => b.id === go.id)?.afterBlockId).toBe(mtg.id);
    expect(gym).toMatchObject({ startMin: 16 * 60, endMin: 17 * 60 + 30, tentative: true });
    // Going to the gym implies the cold is gone, so the message offers Yes.
    expect(r.item.offers).toEqual([{ conditionId: 'cold', question: 'Is the cold fully gone?' }]);
    expect(d.checkIns.map((c) => c.question)).toContain('Is the Go club open?');
  });
});

describe('what the AI gets', () => {
  it('current tasks, routines, the schedule, open check-ins, and recent actual times, in 12-hour times', async () => {
    clock = DateTime.fromISO('2026-10-02T17:30', { zone: CHI });
    await add(lines[0]!);
    reply = () => ({});
    await add('anything');
    const system = prompts.at(-1)!;
    expect(system).toContain('[math-pset] Problem Set 1 (week; class; due Wed 11am; est 120-240 min; MATH 15910; steps: [math-pset-step-1] Do the problems');
    expect(system).toContain('[morning] Morning routine (daily at 9am; steps: [morning-step-1] Brush teeth');
    expect(system).toContain('[rso-fair] today 3pm-3:46pm RSO fair (event)');
    expect(system).toContain('[cold] Is the cold fully gone?');
    expect(system).toContain('Read The Muqaddimah (class): est 180-300, took 82');
    expect(system).toContain('class: 1 done, took 82 min on average, estimated 240');
    // The lists of what exists use 12-hour times (the header and classes keep their older format).
    const lists = system.slice(system.indexOf('Their tasks'), system.indexOf('Reply with'));
    expect(lists).not.toMatch(/\b(1[3-9]|2[0-3]):[0-5]\d\b/);
  });
});

describe('changes to existing things', () => {
  beforeEach(() => {
    clock = DateTime.fromISO('2026-10-02T17:30', { zone: CHI });
  });

  it('deletes, updates, moves, and checks steps', async () => {
    reply = () => ({
      changes: [
        { action: 'delete', id: 'blanket' },
        { action: 'update', id: 'math-pset', due: { date: '2026-10-08', time: '23:59' } },
        { action: 'move', id: 'laundry', date: '2026-10-04' },
        { action: 'checkStep', id: 'muqaddimah', step: 'chapter 2' },
      ],
    });
    const r = await add('delete the blanket thing, math pset is due thursday now, move laundry to Sunday, finished chapter 2');
    expect(addMessage(r.item, '2026-10-02', CHI, LABELS)).toBe(
      'Deleted “New blanket?”. Updated “Problem Set 1”: due Thu 11:59pm. Moved “Laundry” to every Sunday. Checked off “Chapter 2” in “Read The Muqaddimah”. Sorted by AI.',
    );
    expect(db.select().from(t.tasks).all().some((x) => x.id === 'blanket')).toBe(false);
    expect(task('math-pset').dueAt).toBe('2026-10-09T04:59:00Z');
    expect(db.select().from(t.routines).all().find((x) => x.id === 'laundry')?.repeatDays).toEqual([0]);
    expect(db.select().from(t.taskSteps).all().find((x) => x.id === 'muqaddimah-step-1')?.done).toBe(true);
    await call('POST', `/api/undo/${r.undo}`);
    expect(task('blanket')).toBeDefined();
    expect(task('math-pset').dueAt).toBe('2026-10-07T16:00:00Z');
  });

  it('finds the item from the words used, when there’s no id', async () => {
    reply = () => ({ changes: [{ action: 'done', match: 'boxing club' }] });
    const r = await add('checked out the boxing club');
    expect(r.item.changes).toEqual([expect.objectContaining({ action: 'done', id: 'boxing', title: 'Check out boxing club' })]);
    expect(task('boxing').doneAt).not.toBeNull();
  });

  it('records partial progress', async () => {
    reply = () => ({ changes: [{ action: 'log', id: 'muqaddimah', minutes: 40, done: false }] });
    const r = await add('did 40 minutes of the reading');
    expect(addMessage(r.item, '2026-10-02', CHI, LABELS)).toBe('Logged 40 min on “Read The Muqaddimah”, 4:50–5:30pm. Sorted by AI.');
    expect(task('muqaddimah').doneAt).toBeNull();
  });

  it('changes nothing when it’s unclear which item is meant, and asks with a button for each', async () => {
    reply = () => ({ changes: [{ action: 'done', match: 'problem set' }] });
    const r = await add('problem set done');
    expect(r.item.changes).toEqual([]);
    expect(r.item.questions).toEqual([{
      prompt: 'Which one did you mean by “problem set”?',
      options: [{ id: 'math-pset', title: 'Problem Set 1' }, { id: 'econ-pset', title: 'Problem Set 1' }],
      change: expect.objectContaining({ action: 'done' }),
    }]);
    expect(task('math-pset').doneAt).toBeNull();
    expect(task('econ-pset').doneAt).toBeNull();

    // The button makes the change with the one picked.
    const pick = await call<{ item: ChangesResult }>('POST', `/api/changes?tz=${CHI}`, { change: r.item.questions[0]!.change, id: 'econ-pset' });
    expect(pick.body.item.changes).toEqual([expect.objectContaining({ action: 'done', id: 'econ-pset' })]);
    expect(task('econ-pset').doneAt).not.toBeNull();
    expect(task('math-pset').doneAt).toBeNull();
  });

  it('asks when the AI gives options, and says what it couldn’t find', async () => {
    reply = () => ({ changes: [{ action: 'delete', options: ['math-pset', 'econ-pset'] }, { action: 'done', match: 'violin lesson' }] });
    const r = await add('pset done, violin lesson done');
    expect(r.item.questions[0]?.options.map((o) => o.id)).toEqual(['math-pset', 'econ-pset']);
    expect(r.item.missing).toEqual(['violin lesson']);
    expect(addMessage(r.item, '2026-10-02', CHI, LABELS)).toBe('Couldn’t find “violin lesson”. Which one did you mean? Nothing changed yet. Sorted by AI.');
  });
});
