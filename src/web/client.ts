import type { CategoryView, DayView, SettingsView } from '../shared/api';

// Talks to the server. The web app never works out the plan itself; it shows what comes back.

/** The device's time zone, used when the time zone setting is "auto". */
export const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `${method} ${path} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

const tz = () => `tz=${encodeURIComponent(deviceZone())}`;

export interface Loaded {
  day: DayView;
  settings: SettingsView;
  categories: CategoryView[];
}

export async function loadDay(date: string | null): Promise<Loaded> {
  const [day, settings, categories] = await Promise.all([
    send<DayView>('GET', `/api/day${date ? `/${date}` : ''}?${tz()}`),
    send<SettingsView>('GET', '/api/settings'),
    send<CategoryView[]>('GET', '/api/categories'),
  ]);
  return { day, settings, categories: [...categories].sort((a, b) => a.sortOrder - b.sortOrder) };
}

interface Changed {
  undo: string | null;
}

export const api = {
  rollover: () => send<Changed & { item: { moved: string[] } }>('POST', `/api/rollover?${tz()}`),
  undo: (token: string) => send<{ ok: true }>('POST', `/api/undo/${token}`),
  setTaskDone: (id: string, done: boolean) =>
    send<Changed>('PATCH', `/api/tasks/${id}`, { doneAt: done ? new Date().toISOString() : null }),
  setBlockDone: (id: string, done: boolean) => send<Changed>('PATCH', `/api/blocks/${id}`, { done }),
  setRoutineChecked: (routineId: string, date: string, checked: boolean) =>
    send<Changed>(checked ? 'PUT' : 'DELETE', `/api/routine-checks/${routineId}/${date}`),
};
