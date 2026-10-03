import { DateTime } from 'luxon';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgendaView, CategoryView, DayView, MonthView, SettingsView, WeekView } from '../shared/api';
import { createApp } from '../server/app';
import { openDb } from '../server/db/client';
import { seed } from '../server/db/seed';
import { Header } from './Header';
import { Month } from './Month';
import { detailLines } from './Overlays';
import { Rail } from './Rail';
import { Schedule, shown } from './Schedule';
import { TaskPanel, type TaskActions } from './TaskPanel';
import { TimePicker } from './TimePicker';
import { Week, WeekList } from './Week';

// Times are always 12-hour (spec §4). This renders every view from the seeded planner, with
// afternoon blocks added, and looks for a 24-hour time like "13:30" anywhere a person reads.

const CHI = 'America/Chicago';
/** Monday, October 5, 2026 at 1:30pm. ECON at 11, MATH at 12:30, and things into the night. */
const NOW = DateTime.fromISO('2026-10-05T13:30', { zone: CHI });
const DAY = '2026-10-05';

async function load() {
  const db = openDb(':memory:');
  seed(db);
  const app = createApp({ db, now: () => NOW });
  const get = async <T,>(path: string) => (await (await app.request(path)).json()) as T;
  const send = (method: string, path: string, body: unknown) =>
    app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // An event at 2:45pm, a task block at 4:15pm, a timed deadline at 1:30pm, and a routine at 11:30pm.
  await send('POST', '/api/blocks', { kind: 'event', title: 'Office hours', startAt: '2026-10-05T19:45:00Z', durationMinutes: 50, pinned: true });
  await send('POST', '/api/blocks', { kind: 'task', taskId: 'math-pset', startAt: '2026-10-05T21:15:00Z', durationMinutes: 75, pinned: false, reason: 'Due Wed 11am' });
  await send('POST', '/api/tasks', { title: 'Hand in the form', window: 'near', dueAt: '2026-10-05T18:30:00Z' });
  // A "Quick things" block from the planner.
  await send('POST', '/api/tasks', { title: 'Text Sam back', window: 'near', estLow: 5, estHigh: 5, quick: true, dueDate: DAY });
  await send('POST', `/api/plan?tz=${CHI}`, { date: DAY });
  // A logged block: the reading, done 1:05–1:20pm.
  await send('POST', `/api/tasks/response/log?tz=${CHI}`, { startAt: '2026-10-05T18:05:00Z', minutes: 15, done: true });
  const tz = `?tz=${CHI}`;
  return {
    day: await get<DayView>(`/api/day/${DAY}${tz}`),
    week: await get<WeekView>(`/api/week/${DAY}${tz}`),
    month: await get<MonthView>(`/api/month/2026-10${tz}`),
    agenda: await get<AgendaView>(`/api/agenda/${DAY}${tz}`),
    settings: await get<SettingsView>('/api/settings'),
    categories: await get<CategoryView[]>('/api/categories'),
  };
}

const noop = () => {};
const actions = new Proxy({}, { get: () => noop }) as TaskActions;
const drag = { begin: noop, view: null, onGeometry: noop };

/** Readable text and attribute values, without styles, and with 12-hour ranges ("1:30–2:50pm") taken out. */
function readable(html: string): string {
  return html
    .replace(/\sstyle="[^"]*"/g, '')
    .replace(/\d{1,2}(:\d\d)?\s*[–-]\s*\d{1,2}(:\d\d)?\s*(am|pm)/gi, '');
}
const TWENTY_FOUR = /\b([01]?\d|2[0-3]):[0-5]\d\b(?!\s*(am|pm))/i;

describe('labels', () => {
  it('never show a 24-hour time', async () => {
    const v = await load();
    const nowMin = 13 * 60 + 30;
    const html = [
      <Header key="h" view="day" date={DAY} day={v.day} weekStart={0} now={NOW} onView={noop} onShift={noop} onToday={noop} onSettings={noop} />,
      <Schedule
        key="s" day={v.day} settings={v.settings} categories={v.categories} nowMin={nowMin} opened={{ early: true, late: true }}
        onOpen={noop} onCheck={noop} onCheckTask={noop} onDetails={noop} onRemove={noop} onStillOn={noop} onClearSometime={noop} onPlan={noop} drag={drag}
      />,
      <TaskPanel
        key="t" day={v.day} categories={v.categories} filter="all" showDone openId="math-pset" onFilter={noop} onShowDone={noop}
        onToggleOpen={noop} actions={actions} drag={{ begin: noop, over: false }} onAdd={async () => true} fresh={new Set()}
      />,
      <Week key="w" week={v.week} settings={v.settings} categories={v.categories} nowMin={nowMin} onOpenDay={noop} />,
      <WeekList key="wl" week={v.week} categories={v.categories} onOpenDay={noop} />,
      <Month key="m" month={v.month} categories={v.categories} phone={false} onOpenDay={noop} />,
      <Month key="mp" month={v.month} categories={v.categories} phone onOpenDay={noop} />,
      <Rail key="r" month={v.month} coming={v.agenda} selected={DAY} categories={v.categories} onOpenDay={noop} />,
      <TimePicker key="tp" label="Starts" value="13:30" onChange={noop} />,
    ].map((el) => renderToStaticMarkup(el)).join('\n');
    const popovers = v.day.schedule.flatMap((x) => detailLines(shown(x, v.day.today), v.day)).join('\n');

    // The page shows afternoon times, in 12-hour form.
    expect(html).toContain('2:45');
    expect(html).toContain('Quick things');
    expect(html).toContain('15 min (estimated');
    expect(html).toContain('pm');
    const text = readable(`${html}\n${popovers}`);
    expect(text.match(TWENTY_FOUR)?.[0] ?? null).toBeNull();
  });
});
