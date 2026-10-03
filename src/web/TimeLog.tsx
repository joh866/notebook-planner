import { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import type { CategoryView, SessionView, TimeLogEntry } from '../shared/api';
import { catStyle } from './cats';
import { api, type Changed } from './client';
import { cap, fmtDur, fmtTime, momentOn, relWord } from './format';
import { XIcon } from './icons';
import { TimePicker } from './TimePicker';

interface Props {
  zone: string;
  today: string;
  categories: CategoryView[];
  /** Runs an edit with a message and Undo, then reloads. */
  change: <T>(run: () => Promise<Changed<T>>, message: string | null) => Promise<Changed<T> | null>;
  onClose: () => void;
}

const minutesOf = (s: SessionView) => (s.endAt ? Math.round(DateTime.fromISO(s.endAt).diff(DateTime.fromISO(s.startAt), 'minutes').minutes) : null);
const FEEDBACK = { as_planned: 'About as planned', longer: 'Longer than planned', shorter: 'Shorter than planned' } as const;

/** The time log (spec §10): finished tasks, newest first, with the estimate next to the actual time. Entries can be edited. */
export function TimeLog({ zone, today, categories, change, onClose }: Props) {
  const [entries, setEntries] = useState<TimeLogEntry[] | null>(null);
  const [version, setVersion] = useState(0);
  const sheet = useRef<HTMLElement>(null);
  useEffect(() => {
    api.timeLog().then(setEntries, () => setEntries([]));
  }, [version]);
  useEffect(() => sheet.current?.focus(), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const edit = async <T,>(run: () => Promise<Changed<T>>, message: string | null) => {
    await change(run, message);
    setVersion((v) => v + 1);
  };
  const local = (s: string) => DateTime.fromISO(s).setZone(zone);
  /** A session that keeps its length and starts at a new time on the same day. */
  const moveStart = (s: SessionView, hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    const start = local(s.startAt).set({ hour: h, minute: m });
    const len = minutesOf(s) ?? 0;
    void edit(() => api.patchSession(s.id, { startAt: start.toUTC().toISO()!, endAt: start.plus({ minutes: len }).toUTC().toISO()! }), null);
  };
  const setLength = (s: SessionView, raw: string) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n === minutesOf(s)) return;
    void edit(() => api.patchSession(s.id, { endAt: local(s.startAt).plus({ minutes: n }).toUTC().toISO()! }), null);
  };
  const addTime = (e: TimeLogEntry) => {
    const start = DateTime.fromISO(e.doneAt).minus({ minutes: 30 });
    void edit(() => api.addSession(e.taskId, start.toUTC().toISO()!, 30), `Added 30 min to “${e.title}”.`);
  };

  return (
    <div className="sheet-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="sheet timelog" role="dialog" aria-modal="true" aria-label="Time log" ref={sheet} tabIndex={-1}>
        <div className="sheet-head">
          <h2>Time log</h2>
          <button className="del" style={{ opacity: 0.8 }} aria-label="Close the time log" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <p className="hint">What you finished, newest first. Your actual times help the add box estimate the next ones.</p>
        {entries && !entries.length && <p className="hint">Nothing finished yet.</p>}
        {entries?.map((e) => {
          const done = momentOn(e.doneAt, zone);
          const est = e.estLow != null ? `Estimated ${fmtDur(e.estLow, e.estHigh)}` : 'No estimate';
          const took = e.actualMinutes != null ? `took ${fmtDur(e.actualMinutes)}` : e.durationFeedback ? FEEDBACK[e.durationFeedback].toLowerCase() : 'no time recorded';
          return (
            <section key={e.taskId} className="entry" style={catStyle(categories, e.categoryId)}>
              <div className="srow">
                <i className="dot" />
                <span className="grow">
                  <b>{e.title}</b>
                  <div className="sub2">Done {relWord(today, done.date)} {fmtTime(done.min)}. {est}, {took}.</div>
                </span>
              </div>
              {e.sessions.map((s) => (
                <div key={s.id} className="srow session">
                  <span className="grow sub2">{cap(relWord(today, momentOn(s.startAt, zone).date))}</span>
                  <TimePicker label="Started" value={local(s.startAt).toFormat('HH:mm')} onCommit={(v) => moveStart(s, v)} />
                  <input
                    className="mins" inputMode="numeric" aria-label="Minutes" defaultValue={minutesOf(s) ?? ''} key={`${s.id}-${s.endAt}`}
                    onBlur={(ev) => setLength(s, ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && ev.currentTarget.blur()}
                  />
                  <span className="sub2">min</span>
                  <button className="del" aria-label="Delete this time" onClick={() => void edit(() => api.deleteSession(s.id), 'Deleted that time.')}>
                    <XIcon />
                  </button>
                </div>
              ))}
              <button className="linkish" onClick={() => addTime(e)}>Add time</button>
            </section>
          );
        })}
      </aside>
    </div>
  );
}
