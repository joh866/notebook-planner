import type {
  AgendaView,
  CategoryView,
  ConditionAnswer,
  DayView,
  DecisionResult,
  DropInput,
  DropResult,
  MonthView,
  SettingsView,
  WeekView,
} from '../shared/api';

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
  /** Only when the Week tab is open. */
  week: WeekView | null;
  /** The selected day's month: the Month tab and the left rail's mini month. */
  month: MonthView;
  /** The next 10 days from today: the left rail's Coming up list (spec §5). */
  coming: AgendaView;
}

/** Everything one screen shows. `date` is the selected day, or null for today. */
export async function loadAll(date: string | null, withWeek: boolean): Promise<Loaded> {
  const at = date ? `/${date}` : '';
  const [day, settings, categories, week, month, coming] = await Promise.all([
    send<DayView>('GET', `/api/day${at}?${tz()}`),
    send<SettingsView>('GET', '/api/settings'),
    send<CategoryView[]>('GET', '/api/categories'),
    withWeek ? send<WeekView>('GET', `/api/week${at}?${tz()}`) : null,
    send<MonthView>('GET', `/api/month${date ? `/${date.slice(0, 7)}` : ''}?${tz()}`),
    send<AgendaView>('GET', `/api/agenda?days=10&${tz()}`),
  ]);
  return { day, settings, categories: [...categories].sort((a, b) => a.sortOrder - b.sortOrder), week, month, coming };
}

export interface Changed<T = unknown> {
  item: T;
  undo: string | null;
}

/** A weekly class as stored (GET /api/classes/:id). Times are "HH:mm" in its own zone. */
export interface ClassRow {
  id: string;
  code: string;
  kind: string;
  fullName: string | null;
  days: number[];
  start: string;
  end: string;
  timeZone: string;
  location: string | null;
  categoryId: string | null;
}
export type ClassInput = Omit<ClassRow, 'id' | 'timeZone' | 'categoryId'>;

export const api = {
  rollover: () => send<Changed<{ moved: string[] }>>('POST', `/api/rollover?${tz()}`),
  undo: (token: string) => send<{ ok: true }>('POST', `/api/undo/${token}`),
  /** Drag and drop. Positions are minutes on the shown day, in this device's zone. */
  drop: (body: DropInput) => send<Changed<DropResult>>('POST', `/api/drops?${tz()}`, body),

  setTaskDone: (id: string, done: boolean) =>
    send<Changed>('PATCH', `/api/tasks/${id}`, { doneAt: done ? new Date().toISOString() : null }),
  patchTask: (id: string, body: { notes?: string | null; categoryId?: string | null }) => send<Changed>('PATCH', `/api/tasks/${id}`, body),
  deleteTask: (id: string) => send<Changed>('DELETE', `/api/tasks/${id}`),
  decide: (id: string, yes: boolean) => send<Changed<DecisionResult>>('POST', `/api/tasks/${id}/decide`, { yes }),

  addStep: (taskId: string, title: string) => send<Changed>('POST', `/api/tasks/${taskId}/steps`, { title }),
  setStepDone: (id: string, done: boolean) => send<Changed>('PATCH', `/api/task-steps/${id}`, { done }),
  deleteStep: (id: string) => send<Changed>('DELETE', `/api/task-steps/${id}`),

  addCategory: (name: string, color: string) => send<Changed<CategoryView>>('POST', '/api/categories', { name, color }),

  answerCondition: (id: string) => send<Changed<ConditionAnswer>>('POST', `/api/conditions/${id}/answer`),
  snoozeCondition: (id: string, until: string) => send<Changed>('PATCH', `/api/conditions/${id}`, { snoozedUntil: until }),

  setBlockDone: (id: string, done: boolean) => send<Changed>('PATCH', `/api/blocks/${id}`, { done }),
  setBlockPinned: (id: string, pinned: boolean) => send<Changed>('PATCH', `/api/blocks/${id}`, { pinned }),
  deleteBlock: (id: string) => send<Changed>('DELETE', `/api/blocks/${id}`),
  clearSometime: (taskId: string) => send<Changed>('DELETE', `/api/sometime/${taskId}`),

  setRoutineChecked: (routineId: string, date: string, checked: boolean) =>
    send<Changed>(checked ? 'PUT' : 'DELETE', `/api/routine-checks/${routineId}/${date}`),
  skipSlot: (slotId: string, date: string) => send<Changed>('PUT', `/api/slot-exceptions/${slotId}/${date}`, { skipped: true }),
  deleteSlot: (slotId: string) => send<Changed>('DELETE', `/api/routine-slots/${slotId}`),
  deleteRoutine: (id: string) => send<Changed>('DELETE', `/api/routines/${id}`),

  setClassSkipped: (classId: string, homeDate: string, skipped: boolean) =>
    send<Changed>(skipped ? 'PUT' : 'DELETE', `/api/class-skips/${classId}/${homeDate}`),
  getClass: (id: string) => send<ClassRow>('GET', `/api/classes/${id}`),
  addClass: (body: ClassInput) => send<Changed<ClassRow>>('POST', '/api/classes', { ...body, categoryId: 'class' }),
  patchClass: (id: string, body: ClassInput) => send<Changed<ClassRow>>('PATCH', `/api/classes/${id}`, body),
  deleteClass: (id: string) => send<Changed>('DELETE', `/api/classes/${id}`),
};
