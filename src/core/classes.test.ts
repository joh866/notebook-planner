import { describe, expect, it } from 'vitest';
import { deadlineName, namesClass } from './classes';

const CLASSES = [
  { code: 'ECON 20010', kind: 'Lecture' },
  { code: 'ECON 20010', kind: 'Discussion' },
  { code: 'MATH 15910', kind: 'Lecture' },
  { code: 'SOSC 16100', kind: 'Seminar' },
];

describe('namesClass', () => {
  it('is true for names that only say a class', () => {
    for (const s of ['ECON lecture', 'ECON 20010', 'Math lecture', 'the next MATH 15910 class', 'Econ discussion', 'SOSC seminar']) {
      expect(namesClass(s, CLASSES), s).toBe(true);
    }
  });

  it('is false for names that say what the work is', () => {
    for (const s of ['Math PSet 1', 'Econ PSet 1', 'the Muqaddimah reading', 'ECON notes review', 'lecture', '']) {
      expect(namesClass(s, CLASSES), s).toBe(false);
    }
  });
});

describe('deadlineName', () => {
  it('uses the task title when the short name is a class', () => {
    expect(deadlineName({ title: 'Review ECON 20010 discussion notes', shortName: 'ECON lecture' }, CLASSES)).toBe('Review ECON 20010 discussion notes');
  });

  it('keeps a short name that names the work, and falls back to the title', () => {
    expect(deadlineName({ title: 'Problem Set 1', shortName: 'Math PSet 1' }, CLASSES)).toBe('Math PSet 1');
    expect(deadlineName({ title: 'Problem Set 1', shortName: null }, CLASSES)).toBe('Problem Set 1');
  });
});
