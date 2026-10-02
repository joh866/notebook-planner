import { useEffect, useRef, useState } from 'react';
import { api, type ClassInput, type ClassRow } from './client';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EMPTY: ClassInput = { code: '', kind: 'Lecture', fullName: null, days: [], start: '10:00', end: '10:50', location: null };

export const classTitle = (c: { code: string; kind: string }) => `${c.code}${c.kind ? ` ${c.kind.toLowerCase()}` : ''}`;
const daysWords = (days: number[]) => {
  const names = [...days].sort().map((d) => DAYS[d]!.slice(0, 3));
  return names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
};

interface Props {
  /** The class to edit, or null to add one. */
  classId: string | null;
  /** The zone the app shows times in. */
  zone: string;
  weekStart: number;
  onClose: () => void;
  /** After a save or delete: a message, and an Undo token when there is one. */
  onDone: (message: string, undo: string | null) => void;
}

/** Add or edit a weekly class: name, type, full name, days, times, and location (spec §13). */
export function ClassDialog({ classId, zone, weekStart, onClose, onDone }: Props) {
  const [v, setV] = useState<ClassInput | null>(classId ? null : EMPTY);
  const [row, setRow] = useState<ClassRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!classId) return;
    api.getClass(classId).then(
      (c) => {
        setRow(c);
        setV({ code: c.code, kind: c.kind, fullName: c.fullName, days: c.days, start: c.start, end: c.end, location: c.location });
      },
      (e: unknown) => setErr(e instanceof Error ? e.message : 'Couldn’t load the class.'),
    );
  }, [classId]);

  useEffect(() => {
    if (v) first.current?.focus();
  }, [v === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const set = <K extends keyof ClassInput>(k: K, value: ClassInput[K]) => setV((x) => (x ? { ...x, [k]: value } : x));
  const text = (k: 'fullName' | 'location', value: string) => set(k, value.trim() ? value : null);

  const save = async () => {
    if (!v) return;
    const input = { ...v, code: v.code.trim(), kind: v.kind.trim(), fullName: v.fullName?.trim() || null, location: v.location?.trim() || null };
    if (!input.code || !input.kind || !input.days.length || !input.start || !input.end || input.end <= input.start) {
      setErr('Add a name, a type, at least one day, and an end time after the start time.');
      return;
    }
    setBusy(true);
    try {
      if (classId) {
        const r = await api.patchClass(classId, input);
        onDone('Updated.', r.undo);
      } else {
        const r = await api.addClass(input);
        onDone(`${classTitle(input)} added, every ${daysWords(input.days)}.`, r.undo);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That didn’t save.');
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!classId || !row) return;
    setBusy(true);
    try {
      const r = await api.deleteClass(classId);
      onDone(`Deleted ${classTitle(row)}.`, r.undo);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That didn’t delete.');
      setBusy(false);
    }
  };

  const title = classId ? 'Edit' : 'Add a weekly class';
  const order = Array.from({ length: 7 }, (_, i) => (i + weekStart) % 7);
  const away = row && row.timeZone !== zone;

  return (
    <div className="dialog-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h3>{title}</h3>
        {!v ? (
          <p className="pm">{err ?? 'Loading…'}</p>
        ) : (
          <>
            <div className="row">
              <label>
                Name
                <input ref={first} value={v.code} placeholder="CHEM 10100" onChange={(e) => set('code', e.target.value)} />
              </label>
              <label>
                Type
                <input value={v.kind} placeholder="Lecture" onChange={(e) => set('kind', e.target.value)} />
              </label>
            </div>
            <label>
              Full name
              <input value={v.fullName ?? ''} placeholder="Optional" onChange={(e) => text('fullName', e.target.value)} />
            </label>
            <div className="dlab">
              Days
              <div className="days">
                {order.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={v.days.includes(d)}
                    aria-label={DAYS[d]}
                    onClick={() => set('days', v.days.includes(d) ? v.days.filter((x) => x !== d) : [...v.days, d].sort())}
                  >
                    {DAYS[d]!.slice(0, 2)}
                  </button>
                ))}
              </div>
            </div>
            <div className="row">
              <label>
                Starts
                <input type="time" value={v.start} onChange={(e) => set('start', e.target.value)} />
              </label>
              <label>
                Ends
                <input type="time" value={v.end} onChange={(e) => set('end', e.target.value)} />
              </label>
            </div>
            {away && <p className="hint">Times are in {row.timeZone.split('/').pop()!.replace(/_/g, ' ')} time.</p>}
            <label>
              Location
              <input value={v.location ?? ''} placeholder="Building and room" onChange={(e) => text('location', e.target.value)} />
            </label>
            {err && <div className="err">{err}</div>}
            <div className="acts">
              {classId && (
                <button type="button" className="pill" disabled={busy} onClick={() => void remove()}>
                  Delete
                </button>
              )}
              <span className="grow"></span>
              <button type="button" className="pill" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="pill primary" disabled={busy}>
                Save
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
