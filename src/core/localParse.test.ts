import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkText } from './chunk';
import { clockFromText, localParse } from './localParse';

const todo = readFileSync('tests/fixtures/todo-oct-1.txt', 'utf8');
const TODAY = '2026-10-02';
/** The fallback runs per chunk, as the server does when the AI fails. */
const items = chunkText(todo).flatMap((c) => localParse(c, TODAY));
const find = (title: string) => {
  const it = items.find((x) => x.title.startsWith(title));
  if (!it) throw new Error(`No item starting "${title}"`);
  return it;
};

describe('localParse on the October 1 todo', () => {
  it('skips headers and finds every item', () => {
    expect(items.length).toBe(31);
    expect(items.some((x) => /^(Category|10\/\d|SOSC|MATH|ECON|\(before|Today)/.test(x.title))).toBe(false);
  });

  it('carries date, time, and course headers to the lines under them', () => {
    expect(find('Get and read The Muqaddimah')).toMatchObject({ type: 'task', due: { date: '2026-10-06', time: '14:00' }, meta: 'SOSC 16100', cat: 'class', win: 'week' });
    expect(find('Prepare for the reading response')).toMatchObject({ due: { date: '2026-10-06', time: '14:00' } });
    expect(find('Do Problem Set 1, check answers')).toMatchObject({ due: { date: '2026-10-07', time: '11:00' }, meta: 'MATH 15910' });
    expect(items.filter((x) => x.title === 'Do Problem Set 1')).toEqual([
      expect.objectContaining({ due: { date: '2026-10-09', time: '12:00' }, meta: 'ECON 20010' }),
    ]);
  });

  it('turns a timed line under a date into an event', () => {
    expect(find('RSO fair')).toMatchObject({ type: 'event', date: '2026-10-02', start: '15:00' });
  });

  it('stops a header at the blank line', () => {
    expect(find('Get more small towels')).not.toHaveProperty('due');
    expect(find('Get razor')).not.toHaveProperty('due');
  });

  it('reads windows from the remarks, leaving them out of the title', () => {
    expect(find('Get more small towels')).toMatchObject({ title: 'Get more small towels for gym and bathroom', win: 'week', cat: 'errand' });
    expect(find('Clean the wooden container')).toMatchObject({ win: 'near' });
    expect(find('Consolidate plan for quant')).toMatchObject({ win: 'near' });
    expect(find('Study number theory book')).toMatchObject({ win: 'ongoing' });
    expect(find('Get razor')).toMatchObject({ title: 'Get razor', win: 'week' });
  });

  it('makes "?" items decisions, and gives contingent ones an "if" with a question in their own window', () => {
    expect(find('Get a new blanket')).toMatchObject({ title: 'Get a new blanket?', win: 'decide' });
    expect(find('Get foam mattress topper')).toMatchObject({ win: 'decide' });
    expect(find('Skip tomorrow’s econ discussion')).toMatchObject({ win: 'decide' });
    expect(find('Go to gym')).toMatchObject({ title: 'Go to gym', win: 'week', if: 'once recovered fully from cold', ask: 'Once recovered fully from cold?' });
    expect(find('Do the ARCH reading')).toMatchObject({ win: 'week', if: 'if I get in', ask: 'If I get in?' });
    expect(find('Update resume')).toMatchObject({ win: 'soon', ask: 'Once the qnet certificate is received?' });
    expect(find('Check out boxing club')).toMatchObject({ win: 'week', ask: 'Has it happened yet?' });
  });

  it('makes daily, weekly, and every-other-week routines', () => {
    for (const t of ['10 minute meditation', 'Journal at night', 'Do morning routine', 'Gratitude journal']) {
      expect(find(t)).toMatchObject({ type: 'routine', repeat: { days: 'daily' }, cat: 'routine' });
    }
    expect(find('Laundry')).toMatchObject({ type: 'routine', repeat: { days: [6], every: 1 } });
    expect(find('Cleaning dorm')).toMatchObject({ type: 'routine', repeat: { days: [6], every: 2 } });
  });

  it('turns today’s time plan into events, tentative when approximate', () => {
    expect(find('Working on the planning tool')).toMatchObject({ type: 'event', date: TODAY, start: '17:30' });
    expect(find('Dinner')).toMatchObject({ type: 'event', start: '19:00', tentative: true, meta: 'Ask friends when they’re eating as well' });
    expect(find('Sleep')).toMatchObject({ type: 'event', start: '23:30', tentative: true });
    // Lines with no time go in today's Sometime lane.
    expect(find('After dinner, continue')).toMatchObject({ type: 'event', date: TODAY });
    expect(find('After dinner, continue')).not.toHaveProperty('start');
  });

  it('never invents a deadline', () => {
    const dated = items.filter((x) => x.due).map((x) => x.title);
    expect(dated).toEqual([
      'Get and read The Muqaddimah, Chap. 2 & 3, Chap. 6',
      'Prepare for the reading response using potential prompts',
      'Do Problem Set 1, check answers with friend',
      'Do Problem Set 1',
    ]);
  });
});

describe('localParse on short notes', () => {
  it('reads inline deadlines and #tags', () => {
    expect(localParse('Return library book due Tuesday at 5pm #errands', TODAY)).toEqual([
      expect.objectContaining({ title: 'Return library book', due: { date: '2026-10-06', time: '17:00' }, cat: 'errands', win: 'week' }),
    ]);
    expect(localParse('Call mom tomorrow', TODAY)[0]).toMatchObject({ title: 'Call mom', win: 'near' });
    expect(localParse('Practice guitar #music', TODAY)[0]).toMatchObject({ title: 'Practice guitar', cat: 'music', win: 'soon' });
    expect(localParse('Dinner: around 7:30pm? depends on friends', TODAY)[0])
      .toMatchObject({ type: 'event', title: 'Dinner', date: TODAY, start: '19:30', tentative: true, meta: 'Depends on friends' });
    expect(localParse('Today:\n-Call home #family', TODAY)[0]).toMatchObject({ type: 'event', title: 'Call home', cat: 'family' });
  });
});

describe('clockFromText', () => {
  it('reads times, guessing pm for small hours without am or pm', () => {
    expect(clockFromText('2:00pm')).toBe('14:00');
    expect(clockFromText('11:00am')).toBe('11:00');
    expect(clockFromText('12:00pm')).toBe('12:00');
    expect(clockFromText('12am')).toBe('00:00');
    expect(clockFromText('3')).toBe('15:00');
    expect(clockFromText('nothing')).toBeNull();
  });

  it('fixes bedtime am/pm slips', () => {
    expect(clockFromText('12:30pm', true)).toBe('00:30');
    expect(clockFromText('11:30', true)).toBe('23:30');
    expect(clockFromText('1am', true)).toBe('01:00');
  });
});

describe('localParse with times in a line', () => {
  it('reads "at 2:30pm today" as an event, not a "Label: time" line', () => {
    expect(localParse('Meet Sam at 2:30pm today', TODAY)).toEqual([
      expect.objectContaining({ type: 'event', title: 'Meet Sam', date: TODAY, start: '14:30' }),
    ]);
  });

  it('puts a task for today with no time on today', () => {
    expect(localParse('Call the bank today', TODAY)[0]).toMatchObject({ type: 'task', title: 'Call the bank', date: TODAY, win: 'near' });
    expect(localParse('Call mom tomorrow', TODAY)[0]).not.toHaveProperty('date');
  });
});
