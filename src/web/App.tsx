import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { addDays } from '../core/day';
import { lookForHour } from '../core/look';
import { minutesOnDay } from '../core/time';
import type { AddResult, DailyRow, DropInput, RoutineStepView, StepView, TaskCard } from '../shared/api';
import { addMessage, changeText } from './addMessage';
import { categoryName, catName, nextColor } from './cats';
import { ClassDialog, classTitle } from './ClassDialog';
import { api, loadAll, type Changed, type Loaded } from './client';
import { useDrag, type DragItem, type DropTarget, type Geometry } from './drag';
import type { DrawerStop } from './drawer';
import { aroundLabel, cap, fmtDur, fmtTime, joinAnd, planMessage, relWord, repeatWords } from './format';
import { allCards, Header, type View } from './Header';
import { Month } from './Month';
import { CatPicker, Popover, Toast, type ToastState } from './Overlays';
import { Rail } from './Rail';
import { Schedule, type Shown } from './Schedule';
import { logMessage } from './logMessage';
import { Settings } from './Settings';
import { TimeLog } from './TimeLog';
import { TaskPanel, WINDOW_LABEL, type TaskActions } from './TaskPanel';
import { usePhone } from './usePhone';
import { PhoneWeekChoice, Week, WeekList, type PhoneWeek } from './Week';

function useNow(): DateTime {
  const [now, setNow] = useState(() => DateTime.now());
  useEffect(() => {
    const id = setInterval(() => setNow(DateTime.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

let toastId = 0;

const PHONE_WEEK_KEY = 'planner.phoneWeek';
/** Until one is picked (spec §8), the phone week is one day per row, with the time grid a tap away. */
function savedPhoneWeek(): PhoneWeek {
  try {
    return localStorage.getItem(PHONE_WEEK_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

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
  const [catPick, setCatPick] = useState<{ t: TaskCard; el: HTMLElement } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  /** The class dialog: a class id to edit, or 'new'. */
  const [classEdit, setClassEdit] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [timeLogOpen, setTimeLogOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  /** Cards the add box just made, which flash briefly (spec §11, "After adding"). */
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const phone = usePhone();
  const [drawer, setDrawer] = useState<DrawerStop>('peek');
  /** The drawer's stop before a drag closed it, to reopen afterward. */
  const drawerBeforeDrag = useRef<DrawerStop | null>(null);
  const [phoneWeek, setPhoneWeek] = useState<PhoneWeek>(savedPhoneWeek);
  const scrolled = useRef(false);
  const geometry = useRef<Geometry | null>(null);

  const say = useCallback((message: string, actions?: ToastState['actions'], ms?: number) => {
    setToast({ id: ++toastId, message, actions, ms });
  }, []);
  const closeToast = useCallback(() => setToast(null), []);
  const closePop = useCallback(() => setPop(null), []);
  const closeCatPick = useCallback(() => setCatPick(null), []);
  const closeClassEdit = useCallback(() => setClassEdit(null), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // Only the latest request is shown, so a slow older response can't replace a newer day.
  const latest = useRef(0);
  const reload = useCallback(() => {
    const n = ++latest.current;
    return loadAll(sel, view === 'week').then(
      (d) => {
        if (n !== latest.current) return;
        setData(d);
        setError(null);
      },
      (e: unknown) => {
        if (n === latest.current) setError(e instanceof Error ? e.message : String(e));
      },
    );
  }, [sel, view]);

  // At start, move unfinished tasks from past days to today (spec §10, "Rollover").
  const rolled = useRef(false);
  useEffect(() => {
    if (rolled.current) return;
    rolled.current = true;
    api.rollover()
      .then(async (r) => {
        const n = r.item.moved.length;
        if (!n || !r.undo) return;
        const token = r.undo;
        // With automatic scheduling on, some are penciled in already, so they're off the Sometime lane.
        const lane = new Set((await loadAll(null, false)).day.sometime.map((s) => s.taskId));
        const p = r.item.moved.filter((id) => !lane.has(id)).length;
        const tasks = `${n} unfinished task${n > 1 ? 's' : ''}`;
        const msg = !p
          ? `Moved ${tasks} to today’s Sometime lane.`
          : p === n
            ? `Moved ${tasks} to today and penciled ${n > 1 ? 'them' : 'it'} in.`
            : `Moved ${tasks} to today and penciled in ${p}. The rest are in the Sometime lane.`;
        say(msg, [{ label: 'Undo', run: () => void api.undo(token).then(reload) }]);
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

  // On the phone each view opens at its top, and the day scrolls to now again.
  const lastView = useRef(view);
  useLayoutEffect(() => {
    if (lastView.current === view) return;
    lastView.current = view;
    if (!phone) return;
    const main = document.querySelector('.main');
    if (main) main.scrollTop = 0;
    if (view === 'day') scrolled.current = false;
  }, [view, phone]);

  // Escape closes the drawer, unless a popover, picker, or dialog is open (they close first).
  const overlayOpen = !!(pop || catPick || classEdit || settingsOpen || timeLogOpen);
  useEffect(() => {
    if (!phone || drawer === 'peek' || overlayOpen) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setDrawer('peek');
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [phone, drawer, overlayOpen]);

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

  /** An Undo button for one or more tokens, undone newest first. */
  const undoAction = (...tokens: (string | null)[]): ToastState['actions'] => {
    const list = tokens.filter((x): x is string => !!x).reverse();
    if (!list.length) return [];
    return [{ label: 'Undo', run: () => void act(async () => { for (const tk of list) await api.undo(tk); }) }];
  };

  /** Runs a change, reloads, then says what happened with Undo (spec §10, "Undo"). */
  const change = async <T,>(
    run: () => Promise<Changed<T>>,
    message: string | null | ((item: T) => string | null),
    extra: (r: Changed<T>) => ToastState['actions'] = () => [],
  ): Promise<Changed<T> | null> => {
    let r: Changed<T>;
    try {
      r = await run();
    } catch (e) {
      say(e instanceof Error ? e.message : 'That didn’t work.');
      await reload();
      return null;
    }
    await reload();
    const msg = typeof message === 'function' ? message(r.item) : message;
    if (msg) {
      const more = extra(r) ?? [];
      say(msg, [...more, ...(undoAction(r.undo) ?? [])], more.length ? 7000 : undefined);
    }
    return r;
  };

  /**
   * Checks a task off. A task with a range estimate then asks "How long did it take?" (spec §10):
   * one tap, and optional. Fixed-length sessions never ask.
   */
  const checkTask = (id: string, done: boolean) => {
    const t = data ? allCards(data.day.groups).find((x) => x.id === id) : undefined;
    const asks = done && t && t.estLow != null && t.estHigh != null && t.estLow !== t.estHigh && t.sessionMinutes == null;
    if (!asks) return act(() => api.setTaskDone(id, done));
    return change(() => api.setTaskDone(id, true), 'Done. How long did it take?', () => {
      const answer = (label: string, fb: 'as_planned' | 'longer' | 'shorter', reply: string) => ({
        label,
        run: () => void api.setDurationFeedback(id, fb).then(() => say(reply), () => say('Couldn’t save that.')),
      });
      return [
        answer('About as planned', 'as_planned', 'Noted.'),
        answer('Longer', 'longer', 'Noted. Similar tasks will get longer estimates later on.'),
        answer('Shorter', 'shorter', 'Noted. Similar tasks will get shorter estimates later on.'),
      ];
    });
  };
  const checkRoutine = (r: DailyRow) => act(() => api.setRoutineChecked(r.routineId, data!.day.date, !r.checked));
  const checkRoutineStep = (st: RoutineStepView) => act(() => api.setRoutineStepChecked(st.id, data!.day.date, !st.checked));
  const checkBlock = (b: Shown) => {
    const item = b.item;
    if (item.type === 'routine') return act(() => api.setRoutineChecked(item.routineId, data!.day.date, !item.checked));
    if (item.type === 'block' && item.taskId) return checkTask(item.taskId, !item.done);
    if (item.type === 'block') return act(() => api.setBlockDone(item.id, !item.done));
  };

  /** Start and Stop (spec §10, "Actual time"). Done stops it, checks it off, and moves its block to when it happened. */
  const startTask = (id: string, title: string) => void change(() => api.startTask(id), `Started “${title}”.`);
  const stopTask = (id: string, done: boolean) => void change(() => api.stopTask(id, done), (r) => logMessage(r, data!.day.today, data!.day.zone));

  /** "Still on?" on a timed "if" item (spec §7). Yes makes it a normal item; No removes it, with Undo. */
  const stillOn = (b: Shown, yes: boolean) => {
    const item = b.item;
    if (item.type !== 'block') return;
    const [kind, id] = item.taskId ? (['tasks', item.taskId] as const) : (['blocks', item.id] as const);
    void change(() => api.stillOn(kind, id, yes), yes ? `“${b.title}” is on.` : `Removed “${b.title}”.`);
  };

  /** The × on a block, and the matching popover action (spec §7). */
  const removeBlock = (b: Shown) => {
    const item = b.item;
    const date = data!.day.date;
    if (item.type === 'class') {
      return change(
        () => api.setClassSkipped(item.classId, item.homeDate, !item.skipped),
        item.skipped ? 'Not skipping it after all.' : `Skipping ${b.title} ${relWord(data!.day.today, date)}.`,
      );
    }
    if (item.type === 'routine') {
      return change(() => api.skipSlot(item.slotId, date), `Skipped ${b.title} for this day.`, (r) => [{
        label: 'Every day instead',
        run: () => void (async () => {
          if (r.undo) await api.undo(r.undo).catch(() => {});
          await change(() => api.deleteSlot(item.slotId), 'Off the schedule on every day. It’s still in your checklist.');
        })(),
      }]);
    }
    return change(() => api.deleteBlock(item.id), item.kind === 'task' || item.kind === 'quick' ? 'Back on your list.' : `Removed “${b.title}”.`);
  };

  const pinBlock = (b: Shown) => {
    const item = b.item;
    if (item.type !== 'block') return;
    return change(
      () => api.setBlockPinned(item.id, !item.pinned),
      item.pinned ? 'Unpinned. The planner may move it when you plan again.' : 'Pinned here. The planner won’t move it.',
    );
  };

  const classOnScreen = (classId: string) => {
    const c = data?.day.schedule.find((x) => x.type === 'class' && x.classId === classId);
    return c?.type === 'class' ? classTitle(c) : 'the class';
  };

  /** "Every day instead" on a one-day routine change: undo it, then make the change on every day. */
  const everyDayInstead = (token: string | null, body: DropInput, message: string) => () =>
    void (async () => {
      if (token) await api.undo(token).catch(() => {});
      await change(() => api.drop(body), message);
    })();

  /** A finished drag (spec §10, "Drag and drop"). Every drop shows Undo. */
  const dropped = (item: DragItem, target: DropTarget) => {
    const date = data!.day.date;
    if (target.kind === 'resize') {
      if (item.type !== 'resize') return;
      const b = item.b.item;
      const minutes = target.minutes;
      if (minutes === item.b.endMin - item.b.startMin) return;
      const len = fmtDur(minutes);
      if (b.type === 'block') return change(() => api.drop({ action: 'resizeBlock', blockId: b.id, minutes }), `“${item.title}” is now ${len}.`);
      if (b.type === 'routine') {
        const body: DropInput = { action: 'resizeRoutine', slotId: b.slotId, date, minutes };
        return change(() => api.drop(body), `${item.title} is ${len} for this day only.`, (r) => [
          { label: 'Every day instead', run: everyDayInstead(r.undo, { ...body, everyDay: true }, `${item.title} is ${len} on every day.`) },
        ]);
      }
      return;
    }

    if (target.kind === 'grid') {
      const startMin = target.startMin;
      const at = fmtTime(startMin);
      if (item.type === 'task' || item.type === 'sometime') {
        return change(() => api.drop({ action: 'placeTask', taskId: item.taskId, date, startMin }), `Pinned “${item.title}” at ${at}.`);
      }
      if (item.type === 'routine') {
        return change(
          () => api.drop({ action: 'placeRoutine', routineId: item.routineId, date, startMin }),
          (res) => `${item.title} now repeats ${res.routine ? repeatWords(res.routine) : 'every day'} at ${at}.`,
        );
      }
      if (item.type !== 'block' || item.b.startMin === startMin) return;
      const b = item.b.item;
      if (b.type === 'block') {
        const label = b.tentative ? aroundLabel(b.label, startMin) : undefined;
        return change(
          () => api.drop({ action: 'moveBlock', blockId: b.id, date, startMin, label }),
          `Moved “${item.title}” to ${at}${b.pinned ? '' : '. It’s pinned now'}.`,
        );
      }
      if (b.type === 'routine') {
        const body: DropInput = { action: 'moveRoutine', slotId: b.slotId, date, startMin };
        return change(() => api.drop(body), 'Moved for this day only.', (r) => [
          { label: 'Every day instead', run: everyDayInstead(r.undo, { ...body, everyDay: true }, `Moved to ${at} on every day.`) },
        ]);
      }
      return;
    }

    if (target.kind === 'sometime') {
      const lane = `Sometime ${relWord(data!.day.today, date)}`;
      if (item.type === 'task') return change(() => api.drop({ action: 'commitTask', taskId: item.taskId, date }), `Moved “${item.title}” to ${lane}.`);
      if (item.type === 'block' && item.b.item.type === 'block' && item.b.item.taskId) {
        const b = item.b.item;
        return change(() => api.drop({ action: 'commitTask', taskId: b.taskId!, date, blockId: b.id }), `Moved “${item.title}” to ${lane}.`);
      }
      return;
    }

    if (target.kind === 'batch') {
      if (item.type !== 'task') return;
      return change(() => api.drop({ action: 'joinBatch', taskId: item.taskId, blockId: target.blockId }), `Added “${item.title}” to Quick things.`);
    }

    // Onto the task panel.
    if (item.type === 'sometime') return change(() => api.clearSometime(item.taskId), 'Back on your list.');
    if (item.type === 'task' && item.fromBatch) {
      return change(() => api.drop({ action: 'leaveBatch', taskId: item.taskId, blockId: item.fromBatch! }), 'Back on your list.');
    }
    if (item.type !== 'block') return;
    const b = item.b.item;
    if (b.type === 'routine') {
      return change(() => api.deleteSlot(b.slotId), `${item.title} is off the schedule. It’s still in your checklist.`);
    }
    if (b.type === 'block') return change(() => api.deleteBlock(b.id), b.kind === 'task' || b.kind === 'quick' ? 'Back on your list.' : `Removed “${item.title}”.`);
  };

  const drag = useDrag({
    geometry: () => geometry.current,
    onStart: (item) => {
      setPop(null);
      setCatPick(null);
      // Dragging a task out of the drawer closes it, so the schedule is free for the drop (spec §5).
      if (phone && item.type !== 'block' && item.type !== 'resize' && drawer !== 'peek') {
        drawerBeforeDrag.current = drawer;
        setDrawer('peek');
      }
    },
    onEnd: () => {
      if (drawerBeforeDrag.current) setDrawer(drawerBeforeDrag.current);
      drawerBeforeDrag.current = null;
    },
    onDrop: (item, target) => void dropped(item, target),
    onOpenStrip: (id) => setOpened((o) => ({ ...o, [id]: true })),
  });

  const actions: TaskActions = {
    checkTask,
    checkRoutine,
    checkRoutineStep,
    deleteTask: (t) => {
      if (openId === t.id) setOpenId(null);
      void change(() => api.deleteTask(t.id), `Deleted “${t.title}”.`);
    },
    deleteRoutine: (r: DailyRow) => void change(() => api.deleteRoutine(r.routineId), `Deleted “${r.title}”.`),
    decide: (t, yes) => void change(() => api.decide(t.id, yes), (res) => {
      if (res.made) return `Moved “${res.made.title}” to ${WINDOW_LABEL[res.made.window] ?? res.made.window}.`;
      if (res.skipped) return `Skipping ${classOnScreen(res.skipped.classId)} ${relWord(data!.day.today, res.skipped.date)}. It’s marked on the schedule.`;
      return yes ? 'Noted.' : 'Dropped it.';
    }),
    answer: (id) => void change(() => api.answerCondition(id), (res) =>
      res.cleared.length ? `${cap(joinAnd(res.cleared.map((x) => `“${x.title}”`)))} ${res.cleared.length > 1 ? 'are' : 'is'} on.` : 'Noted.'),
    notYet: (id) => void change(() => api.snoozeCondition(id, addDays(data!.day.today, 1)), 'Asking again tomorrow.'),
    pickCategory: (t, el) => {
      setPop(null);
      setCatPick({ t, el });
    },
    checkStep: (st: StepView, done) => void change(() => api.setStepDone(st.id, done), null),
    addStep: (taskId, title) => void change(() => api.addStep(taskId, title), null),
    removeStep: (st) => void change(() => api.deleteStep(st.id), `Removed the step “${st.title}”.`),
    saveNotes: (taskId, notes) => void change(() => api.patchTask(taskId, { notes }), null),
    start: (t) => startTask(t.id, t.title),
    stop: (t, done) => stopTask(t.id, done),
    setEstimate: (t, estLow, estHigh) => void change(() => api.patchTask(t.id, { estLow, estHigh }),
      estLow == null ? `Cleared the estimate for “${t.title}”.` : `“${t.title}” is about ${fmtDur(estLow, estHigh)} now. Noted for next time.`),
    openTimeLog: () => setTimeLogOpen(true),
  };

  /** The add box: everything is added right away, with one Undo (spec §11). */
  const addText = async (text: string): Promise<boolean> => {
    let r: Changed<AddResult>;
    try {
      r = await api.add(text);
    } catch (e) {
      say(e instanceof Error ? `Couldn’t add that: ${e.message}` : 'Couldn’t add that.');
      return false;
    }
    await reload();
    const { today, zone } = data!.day;
    // A button for each item an unclear change could mean, and Yes for any check-in the text answers (spec §11).
    const choices = r.item.questions.flatMap((q) => q.options.map((o) => ({
      label: o.title,
      run: () => void change(() => api.applyChange(q.change, o.id), (res) => res.changes.map((x) => changeText(x, today, zone)).join(' ') || 'Done.'),
    })));
    const offers = r.item.offers.map((o) => ({
      label: `${o.question} Yes`,
      run: () => actions.answer(o.conditionId),
    }));
    say(addMessage(r.item, today, zone, WINDOW_LABEL), [...choices, ...offers, ...(undoAction(r.undo) ?? [])], choices.length || offers.length ? 15000 : 9000);
    const cards = r.item.added.filter((a) => a.kind === 'task' || a.kind === 'sometime').map((a) => a.id);
    if (!cards.length) return true;
    setFilter('all');
    setFresh(new Set(cards));
    setTimeout(() => setFresh(new Set()), 3500);
    if (phone && drawer === 'peek') setDrawer('half');
    requestAnimationFrame(() => document.querySelector(`.card[data-id="${cards[0]}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    return true;
  };

  const pickCategory = (t: TaskCard, id: string) =>
    void change(() => api.patchTask(t.id, { categoryId: id }), `Moved “${t.title}” to ${catName(data!.categories, id)}.`);
  const newCategory = async (t: TaskCard, raw: string) => {
    const name = categoryName(raw);
    try {
      const made = await api.addCategory(name, nextColor(data!.categories));
      const moved = await api.patchTask(t.id, { categoryId: made.item.id });
      await reload();
      say(`Made a new category, “${name}”.`, undoAction(made.undo, moved.undo));
    } catch (e) {
      say(e instanceof Error ? e.message : 'That didn’t work.');
      await reload();
    }
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
  /** Clicking a day in the week, the month, or the left rail opens it in the Day view (spec §5, §8). */
  const openDay = (d: string) => {
    setView('day');
    go(d);
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
      <div className="screen" data-view={view} data-wk={phone ? phoneWeek : undefined}>
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
          onSettings={() => {
            setPop(null);
            setCatPick(null);
            setSettingsOpen(true);
          }}
        />
        <Rail month={data.month} coming={data.coming} selected={day.date} categories={categories} onOpenDay={openDay} />
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
              onRemove={(b) => void removeBlock(b)}
              onStillOn={stillOn}
              onClearSometime={(taskId) => void change(() => api.clearSometime(taskId), 'Back on your list.')}
              onPlan={(target) => void change(() => api.plan(target), (r) => planMessage(r, day.today, day.zone))}
              drag={{
                begin: drag.begin,
                view: drag.view,
                onGeometry: (g) => {
                  geometry.current = g;
                },
              }}
            />
          ) : view === 'week' ? (
            data.week ? (
              <>
                {phone && (
                  <PhoneWeekChoice
                    value={phoneWeek}
                    onChange={(v) => {
                      setPhoneWeek(v);
                      try {
                        localStorage.setItem(PHONE_WEEK_KEY, v);
                      } catch {
                        // Not saved; it still applies until the page reloads.
                      }
                    }}
                  />
                )}
                {phone && phoneWeek === 'list' ? (
                  <WeekList week={data.week} categories={categories} onOpenDay={openDay} />
                ) : (
                  <Week
                    week={data.week}
                    settings={settings}
                    categories={categories}
                    nowMin={minutesOnDay(now, day.today, zone)}
                    onOpenDay={openDay}
                  />
                )}
              </>
            ) : (
              <p className="loading">Loading…</p>
            )
          ) : (
            <Month month={data.month} categories={categories} phone={phone} onOpenDay={openDay} />
          )}
        </main>
        {phone && view === 'day' && drawer !== 'peek' && <div className="backdrop" onClick={() => setDrawer('peek')} />}
        {view === 'day' && (
          <TaskPanel
            day={day}
            categories={categories}
            filter={filter}
            showDone={showDone}
            openId={openId}
            onFilter={setFilter}
            onShowDone={setShowDone}
            onToggleOpen={(id) => setOpenId((o) => (o === id ? null : id))}
            actions={actions}
            drag={{ begin: drag.begin, over: drag.view?.target?.kind === 'tasks' }}
            drawer={phone ? { stop: drawer, onStop: setDrawer } : undefined}
            onAdd={addText}
            fresh={fresh}
          />
        )}
      </div>
      {pop && (
        <Popover
          b={pop.b}
          anchor={pop.el}
          day={day}
          onCheck={checkBlock}
          onRemove={(b) => void removeBlock(b)}
          onPin={(b) => void pinBlock(b)}
          onStillOn={stillOn}
          onStart={(taskId, title) => startTask(taskId, title)}
          onStop={(taskId, done) => stopTask(taskId, done)}
          onEditClass={setClassEdit}
          onClose={closePop}
        />
      )}
      {catPick && (
        <CatPicker
          anchor={catPick.el}
          current={catPick.t.categoryId}
          categories={categories}
          onPick={(id) => pickCategory(catPick.t, id)}
          onNew={(name) => void newCategory(catPick.t, name)}
          onClose={closeCatPick}
        />
      )}
      {settingsOpen && (
        <Settings
          settings={settings}
          categories={categories}
          covered={!!classEdit}
          change={change}
          say={say}
          onEditClass={setClassEdit}
          onDayTimes={() => setOpened({ early: false, late: false })}
          onTimeLog={() => {
            closeSettings();
            setTimeLogOpen(true);
          }}
          onClose={closeSettings}
        />
      )}
      {timeLogOpen && (
        <TimeLog zone={day.zone} today={day.today} categories={categories} change={change} onClose={() => setTimeLogOpen(false)} />
      )}
      {classEdit && (
        <ClassDialog
          classId={classEdit === 'new' ? null : classEdit}
          zone={day.zone}
          weekStart={settings.weekStart}
          onClose={closeClassEdit}
          onDone={(message, token) => {
            setClassEdit(null);
            void reload().then(() => say(message, undoAction(token)));
          }}
        />
      )}
      <Toast key={toast?.id} toast={toast} onClose={closeToast} />
    </div>
  );
}
