import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AddResult, DayView } from '../shared/api';
import { anthropicSorter, readReply, SortError, type SortChunk } from './ai';
import { createApp } from './app';
import { openDb } from './db/client';
import { seed } from './db/seed';

const CHI = 'America/Chicago';
/** Friday, October 2, 2026 at 5:30pm in Chicago. */
const NOW = DateTime.fromISO('2026-10-02T17:30', { zone: CHI });

type Row = Record<string, unknown>;
let app: ReturnType<typeof createApp>;
let calls: { system: string; chunk: string }[];

function setup(sort: SortChunk) {
  const db = openDb(':memory:');
  seed(db);
  calls = [];
  app = createApp({ db, now: () => NOW, sort: (system, chunk) => { calls.push({ system, chunk }); return sort(system, chunk); } });
}

async function call<T = Row>(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}
const add = (text: string) => call<{ item: AddResult; undo: string | null }>('POST', '/api/add?tz=America/Chicago', { text });
const rows = (path: string) => call<Row[]>('GET', path).then((r) => r.body);
const byTitle = (list: Row[], title: string) => list.find((r) => r.title === title || r.code === title);

describe('POST /api/add with the AI', () => {
  beforeEach(() => setup(async () => [
    { type: 'task', title: 'Read chapter 4', cat: 'class', win: 'week', due: { date: '2026-10-06', time: '14:00' }, short: 'Ch. 4 reading',
      est: [90, 60], sitting: 45, steps: ['Skim', { title: 'Take notes', minutes: 30 }], meta: 'SOSC 16100' },
    { type: 'task', title: 'Turn in the form', due: { date: '2026-10-09' }, cat: 'errand', win: 'soon' },
    { type: 'task', title: 'Get a lamp?', win: 'decide', cat: 'errand' },
    { type: 'task', title: 'Try climbing', win: 'waiting', wait: 'is the cold fully gone?', cat: 'life' },
    { type: 'task', title: 'Practice scales', cat: 'music', win: 'ongoing', session: 20 },
    { type: 'task', title: 'Write the poem', cat: 'poetry', win: 'soon' },
    { type: 'routine', title: 'Water plants', repeat: { days: [0], every: 2 }, est: [10, 10] },
    { type: 'routine', title: 'Stretch', repeat: { days: 'daily' }, start: '8:00', end: '08:15' },
    { type: 'event', title: 'Dinner', date: '2026-10-02', start: '19:00', tentative: true, meta: 'Depends on friends', cat: 'life' },
    { type: 'event', title: 'Call home', date: '2026-10-02', start: '00:30' },
    { type: 'event', title: 'Pick up package', date: '2026-10-03' },
    { type: 'class', title: 'CHEM 11100', kind: 'Lab', repeat: { days: [4] }, start: '09:30', end: '12:20', loc: 'Kent 101' },
    { type: 'class', title: 'Office hours' },
    { title: '' },
    'nonsense',
  ]));

  it('sends the prompt context and each chunk', async () => {
    await add('Read chapter 4 by Tuesday 2pm #music');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.chunk).toBe('Read chapter 4 by Tuesday 2pm #music');
    expect(calls[0]!.system).toContain('Today is Friday 2026-10-02, and the time is 17:30.');
    expect(calls[0]!.system).toContain('ECON 20010 Lecture Mon/Wed 11:00-12:20');
  });

  it('adds every kind of item, as the result says', async () => {
    const { status, body } = await add('Read chapter 4 by Tuesday 2pm #music');
    expect(status).toBe(200);
    expect(body.item).toMatchObject({ chunks: 1, fellBack: 0, reason: null });
    expect(body.item.added.map((a) => [a.kind, a.title])).toEqual([
      ['task', 'Read chapter 4'], ['task', 'Turn in the form'], ['task', 'Get a lamp?'], ['task', 'Try climbing'],
      ['task', 'Practice scales'], ['task', 'Write the poem'], ['routine', 'Water plants'], ['routine', 'Stretch'],
      ['event', 'Dinner'], ['event', 'Call home'], ['sometime', 'Pick up package'], ['class', 'CHEM 11100 lab'], ['task', 'Office hours'],
    ]);
    // Urgency: due Tuesday is This week; due next Friday stays in Soon.
    expect(body.item.added.slice(0, 2)).toMatchObject([{ window: 'week' }, { window: 'soon' }]);

    const tasks = await rows('/api/tasks');
    const read = byTitle(tasks, 'Read chapter 4')!;
    expect(read).toMatchObject({
      window: 'week', categoryId: 'class', dueAt: '2026-10-06T19:00:00Z', dueDate: null, shortName: 'Ch. 4 reading',
      estLow: 60, estHigh: 90, sittingMinutes: 45, meta: 'SOSC 16100',
    });
    const steps = await rows(`/api/task-steps?taskId=${read.id}`);
    expect(steps.map((s) => [s.title, s.minutes, s.waiting])).toEqual([['Skim', null, false], ['Take notes', 30, false]]);

    expect(byTitle(tasks, 'Turn in the form')).toMatchObject({ dueDate: '2026-10-09', dueAt: null });
    expect(byTitle(tasks, 'Get a lamp?')).toMatchObject({ window: 'decide', decisionYes: { makeTask: { title: 'Get a lamp', window: 'soon' } } });
    // The same check-in question is reused, so it asks once for both.
    expect(byTitle(tasks, 'Try climbing')).toMatchObject({ window: 'waiting', conditionId: 'cold' });
    expect(byTitle(tasks, 'Practice scales')).toMatchObject({ sessionMinutes: 20, estLow: null });
    expect(byTitle(tasks, 'Office hours')).toMatchObject({ window: 'soon', categoryId: 'life' });
  });

  it('makes a category only for a #tag in the text', async () => {
    await add('Read chapter 4 by Tuesday 2pm #music');
    const cats = await rows('/api/categories');
    const music = byTitle(cats.map((c) => ({ ...c, title: c.name })), 'Music')!;
    expect(music).toMatchObject({ builtin: false, color: '#E07B39' });
    expect(cats.some((c) => c.name === 'Poetry')).toBe(false);
    const tasks = await rows('/api/tasks');
    expect(byTitle(tasks, 'Practice scales')!.categoryId).toBe(music.id);
    expect(byTitle(tasks, 'Write the poem')!.categoryId).toBe('life');
  });

  it('adds routines with repeats, lengths, and times', async () => {
    await add('x');
    const routines = await rows('/api/routines');
    // Every other Sunday counts from the first Sunday from today on.
    expect(byTitle(routines, 'Water plants')).toMatchObject({
      repeat: 'weekly', repeatDays: [0], repeatEvery: 2, repeatFrom: '2026-10-04', durationMinutes: 10, categoryId: 'routine',
    });
    const stretch = byTitle(routines, 'Stretch')!;
    expect(stretch).toMatchObject({ repeat: 'daily', durationMinutes: 15 });
    expect(await rows(`/api/routine-slots?routineId=${stretch.id}`)).toEqual([expect.objectContaining({ start: '08:00', durationMinutes: 15 })]);
  });

  it('puts timed events on the schedule and the rest in the Sometime lane', async () => {
    await add('x');
    const blocks = await rows('/api/blocks');
    expect(byTitle(blocks, 'Dinner')).toMatchObject({
      kind: 'event', startAt: '2026-10-03T00:00:00Z', durationMinutes: 60, tentative: true, label: 'Around 7pm, depends on friends', pinned: true,
    });
    // 00:30 belongs to the night of the given day.
    expect(byTitle(blocks, 'Call home')).toMatchObject({ startAt: '2026-10-03T05:30:00Z', tentative: false });
    const sat = (await call<DayView>('GET', '/api/day/2026-10-03?tz=America/Chicago')).body;
    expect(sat.sometime.map((s) => s.title)).toEqual(['Pick up package']);
    const classes = await rows('/api/classes');
    expect(byTitle(classes, 'CHEM 11100')).toMatchObject({ kind: 'Lab', days: [4], start: '09:30', end: '12:20', location: 'Kent 101', timeZone: CHI });
  });

  it('undoes the whole add at once', async () => {
    const before = await Promise.all(['/api/tasks', '/api/routines', '/api/blocks', '/api/classes', '/api/categories', '/api/conditions'].map(rows));
    const { body } = await add('Read chapter 4 by Tuesday 2pm #music');
    expect((await call('POST', `/api/undo/${body.undo}`)).status).toBe(200);
    const after = await Promise.all(['/api/tasks', '/api/routines', '/api/blocks', '/api/classes', '/api/categories', '/api/conditions'].map(rows));
    expect(after).toEqual(before);
  });

  it('rejects empty text', async () => {
    expect((await add('   ')).status).toBe(400);
  });
});

describe('POST /api/add without the AI', () => {
  it('falls back to the local guess for every chunk and says why', async () => {
    setup(() => Promise.reject(new SortError('there’s no ANTHROPIC_API_KEY in .env')));
    const { body } = await add('Get razor (in the near future)\nCall mom tomorrow');
    expect(body.item).toMatchObject({ chunks: 1, fellBack: 1, reason: 'there’s no ANTHROPIC_API_KEY in .env' });
    expect(body.item.added).toEqual([
      expect.objectContaining({ kind: 'task', title: 'Get razor', window: 'week' }),
      expect.objectContaining({ kind: 'task', title: 'Call mom', window: 'near' }),
    ]);
  });

  it('falls back only for the chunks that failed', async () => {
    let n = 0;
    setup(async () => {
      if (n++ === 0) return [{ type: 'task', title: 'From the AI', win: 'soon' }];
      throw new SortError('the AI took too long to answer');
    });
    const text = `${Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`).join('\n')}\n\nGet razor`;
    const { body } = await add(text);
    expect(body.item).toMatchObject({ chunks: 2, fellBack: 1, reason: 'the AI took too long to answer' });
    expect(body.item.added.map((a) => a.title)).toEqual(['From the AI', 'Get razor']);
  });
});

describe('the AI client', () => {
  it('reads JSON even inside code fences or prose', () => {
    expect(readReply('```json\n{"items":[{"title":"A"}]}\n```')).toEqual([{ title: 'A' }]);
    expect(readReply('Here you go: {"items":[]} Done.')).toEqual([]);
    expect(() => readReply('no json')).toThrow('no JSON');
    expect(() => readReply('{"items": [}')).toThrow('valid JSON');
    expect(() => readReply('{"things": []}')).toThrow('no items list');
  });

  it('fails with a reason when there’s no key, without calling anything', async () => {
    await expect(anthropicSorter({})('system', 'text')).rejects.toThrow('there’s no ANTHROPIC_API_KEY in .env');
  });
});
