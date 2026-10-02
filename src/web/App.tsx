import { useCallback, useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { addDays } from '../core/day';
import { lookForHour } from '../core/look';
import { minutesOnDay } from '../core/time';
import type { DailyRow } from '../shared/api';
import { api, loadDay, type Loaded } from './client';
import { Header, type View } from './Header';
import { Popover, Toast, type ToastState } from './Overlays';
import { Schedule, type Shown } from './Schedule';
import { TaskPanel } from './TaskPanel';

function useNow(): DateTime {
  const [now, setNow] = useState(() => DateTime.now());
  useEffect(() => {
    const id = setInterval(() => setNow(DateTime.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

let toastId = 0;

export function App() {
  const now = useNow();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The selected day, or null for today. */
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<View>('day');
  const [opened, setOpened] = useState({ early: false, late: false });
  const [filter, setFilter] = useState('all');
  const [showDone, setShowDone] = useState(false);
  const [pop, setPop] = useState<{ b: Shown; el: HTMLElement } | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const scrolled = useRef(false);

  const say = useCallback((message: string, actions?: ToastState['actions'], ms?: number) => {
    setToast({ id: ++toastId, message, actions, ms });
  }, []);
  const closeToast = useCallback(() => setToast(null), []);
  const closePop = useCallback(() => setPop(null), []);

  // Only the latest request is shown, so a slow older response can't replace a newer day.
  const latest = useRef(0);
  const reload = useCallback(() => {
    const n = ++latest.current;
    return loadDay(sel).then(
      (d) => {
        if (n !== latest.current) return;
        setData(d);
        setError(null);
      },
      (e: unknown) => {
        if (n === latest.current) setError(e instanceof Error ? e.message : String(e));
      },
    );
  }, [sel]);

  // At start, move unfinished tasks from past days to today (spec §10, "Rollover").
  const rolled = useRef(false);
  useEffect(() => {
    if (rolled.current) return;
    rolled.current = true;
    api.rollover()
      .then((r) => {
        const n = r.item.moved.length;
        if (!n || !r.undo) return;
        const token = r.undo;
        say(`Moved ${n} unfinished task${n > 1 ? 's' : ''} to today’s Sometime lane.`, [
          { label: 'Undo', run: () => void api.undo(token).then(reload) },
        ]);
        return reload();
      })
      .catch(() => {});
  }, [say, reload]);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 60_000);
    const focus = () => void reload();
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', focus);
    };
  }, [reload]);

  const zone = data?.day.zone ?? (now.zoneName || 'local');
  const zoned = now.setZone(zone);
  const look = lookForHour(zoned.hour, data?.settings.look ?? 'auto');
  useEffect(() => {
    document.body.dataset.mode = look;
  }, [look]);

  // The 60-second reload picks up the new day after 4am.
  const today = data?.day.today;
  const date = data?.day.date;
  const nowMin = data && date === today ? minutesOnDay(now, data.day.date, zone) : null;

  useEffect(() => {
    if (scrolled.current || !data || view !== 'day') return;
    scrolled.current = true;
    if (nowMin == null) return;
    requestAnimationFrame(() => document.querySelector('.now')?.scrollIntoView({ block: 'center' }));
  }, [data, view, nowMin]);

  const act = useCallback(
    async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (e) {
        say(e instanceof Error ? e.message : 'That didn’t work.');
      }
      await reload();
    },
    [reload, say],
  );

  const checkTask = (id: string, done: boolean) => act(() => api.setTaskDone(id, done));
  const checkRoutine = (r: DailyRow) => act(() => api.setRoutineChecked(r.routineId, data!.day.date, !r.checked));
  const checkBlock = (b: Shown) => {
    const item = b.item;
    if (item.type === 'routine') return act(() => api.setRoutineChecked(item.routineId, data!.day.date, !item.checked));
    if (item.type === 'block' && item.taskId) return checkTask(item.taskId, !item.done);
    if (item.type === 'block') return act(() => api.setBlockDone(item.id, !item.done));
  };

  if (!data) {
    return (
      <div className="device">
        <p className="loading">{error ? `Couldn’t load the planner: ${error}` : 'Loading…'}</p>
      </div>
    );
  }

  const { day, settings, categories } = data;
  const go = (d: string | null) => {
    setPop(null);
    setSel(d === day.today ? null : d);
  };
  // Counted from the selected day, not the loaded one, so quick clicks all count.
  const shift = (dir: -1 | 1) => {
    const from = sel ?? day.today;
    if (view === 'day') return go(addDays(from, dir));
    if (view === 'week') return go(addDays(from, 7 * dir));
    go(DateTime.fromISO(from).plus({ months: dir }).startOf('month').toFormat('yyyy-MM-dd'));
  };

  return (
    <div className="device">
      <div className="screen" data-view={view}>
        <Header
          view={view}
          date={day.date}
          day={day}
          weekStart={settings.weekStart}
          now={zoned}
          onView={(v) => {
            setPop(null);
            setView(v);
          }}
          onShift={shift}
          onToday={() => go(null)}
          onSettings={() => say('Settings come in a later step.')}
        />
        <main className="main">
          {view === 'day' ? (
            <Schedule
              day={day}
              settings={settings}
              categories={categories}
              nowMin={nowMin}
              opened={opened}
              onOpen={(id, open) => setOpened((o) => ({ ...o, [id]: open }))}
              onCheck={checkBlock}
              onCheckTask={checkTask}
              onDetails={(b, el) => setPop({ b, el })}
              onPlan={() => say('The planner isn’t built yet. It comes in a later step.')}
            />
          ) : (
            <section className="box soon-view">
              <p>The {view} view comes in a later step. Use the Day tab for now.</p>
            </section>
          )}
        </main>
        {view === 'day' && (
          <TaskPanel
            day={day}
            categories={categories}
            filter={filter}
            showDone={showDone}
            onFilter={setFilter}
            onShowDone={setShowDone}
            onCheckTask={checkTask}
            onCheckRoutine={checkRoutine}
          />
        )}
      </div>
      {pop && <Popover b={pop.b} anchor={pop.el} day={day} onCheck={checkBlock} onClose={closePop} />}
      <Toast key={toast?.id} toast={toast} onClose={closeToast} />
    </div>
  );
}
