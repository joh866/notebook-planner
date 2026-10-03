import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canvasAssignments } from './canvas';
import { parseICal } from './ical';

const feed = readFileSync(fileURLToPath(new URL('../../tests/fixtures/canvas-feed.ics', import.meta.url)), 'utf8');

describe('parseICal', () => {
  const events = parseICal(feed);

  it('reads every event, with moments, whole days, and zoned times', () => {
    expect(events.map((e) => [e.uid, e.startAt, e.startDate])).toEqual([
      ['event-assignment-67890', '2026-10-07T16:00:00Z', null],
      ['event-assignment-67891', null, '2026-10-09'],
      ['event-assignment-67892', '2026-10-13T04:59:00Z', null],
      ['event-calendar-event-5555', '2026-10-08T19:00:00Z', null],
      ['event-assignment-67893', '2026-10-20T04:59:00Z', null],
      ['event-assignment-67000', '2026-09-25T04:59:00Z', null],
    ]);
  });

  it('unfolds long lines and unescapes text', () => {
    expect(events[2]!.summary).toBe('Problem Set 2: supply, demand, and elasticities [ECON 20010 1 (Autumn 2026) The Elements of Economic Analysis I Honors]');
    expect(events[0]!.description).toBe('Problems 1–6 from chapter 1, written up in LaTeX.');
    expect(events[0]!.url).toBe('https://canvas.example.edu/courses/12345/assignments/67890');
  });
});

describe('canvasAssignments', () => {
  it('keeps assignments, matched to a course by its code', () => {
    const list = canvasAssignments(parseICal(feed), ['ECON 20010', 'MATH 15910', 'SOSC 16100']);
    expect(list.map((a) => [a.title, a.course, a.dueAt ?? a.dueDate])).toEqual([
      ['Problem Set 1', 'MATH 15910', '2026-10-07T16:00:00Z'],
      ['Reading response 1', 'SOSC 16100', '2026-10-09'],
      ['Problem Set 2: supply, demand, and elasticities', 'ECON 20010', '2026-10-13T04:59:00Z'],
      // Not one of their classes: the code from Canvas still names it.
      ['Lab report 1', 'CHEM 11100', '2026-10-20T04:59:00Z'],
      ['Syllabus quiz', 'MATH 15910', '2026-09-25T04:59:00Z'],
    ]);
  });
});
