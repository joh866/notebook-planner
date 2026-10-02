import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkText, isHeaderLine } from './chunk';

const todo = readFileSync('tests/fixtures/todo-oct-1.txt', 'utf8');
const lines = (chunk: string) => chunk.split('\n').filter(Boolean);

describe('chunkText', () => {
  it('keeps a short note as one chunk', () => {
    expect(chunkText('Get razor\nCall mom')).toEqual(['Get razor\nCall mom']);
    expect(chunkText('  \n\n ')).toEqual([]);
  });

  it('splits along paragraphs, at most 12 lines each, keeping the blank line between paragraphs', () => {
    const chunks = chunkText(todo);
    expect(chunks.length).toBe(4);
    for (const c of chunks) expect(lines(c).length).toBeLessThanOrEqual(12);
    // Every line of the todo is in exactly one chunk.
    const all = todo.replace(/^\uFEFF/, '').split('\n').map((l) => l.trim()).filter(Boolean);
    expect(chunks.flatMap(lines)).toEqual(all);
    expect(chunks[1]).toContain('Do Problem Set 1\n\n-Get more small towels');
  });

  it('cuts a long paragraph before a date header, so the date stays with its items', () => {
    const [first, second] = chunkText(todo);
    expect(lines(first!).at(-1)).toBe('-Do Problem Set 1, check answers with friend');
    expect(lines(second!).slice(0, 4)).toEqual(['10/9 (Friday)', '(before 12:00pm)', 'ECON 20010', '-Do Problem Set 1']);
  });

  it('keeps today’s time plan together', () => {
    expect(chunkText(todo).at(-1)).toMatch(/^Today:\nRight now: 5:30pm/m);
  });
});

describe('isHeaderLine', () => {
  it('knows dates, course codes, time remarks, and labels', () => {
    for (const h of ['10/6 (Tuesday)', 'SOSC 16100', '(before 2:00pm)', 'Category: Homework', 'Today:']) expect(isHeaderLine(h)).toBe(true);
    for (const x of ['-Get razor', 'Dinner: Around 7:00pm?', 'Get razor']) expect(isHeaderLine(x)).toBe(false);
  });
});
