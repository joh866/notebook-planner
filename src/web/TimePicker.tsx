import { useRef, useState } from 'react';
import { clockParts, clockValue, minuteChoices, type ClockParts } from './timeParts';

interface Props {
  /** "HH:mm". */
  value: string;
  label: string;
  /** Called on every change. */
  onChange?: (v: string) => void;
  /** Called once focus leaves the picker with a new value, so a half-made change isn't saved. */
  onCommit?: (v: string) => void;
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** A 12-hour time picker (spec §4): hour, minute, and am or pm. */
export function TimePicker({ value, label, onChange, onCommit }: Props) {
  const [draft, setDraft] = useState(value);
  // A new saved value (after Undo, say) replaces the draft.
  const [saved, setSaved] = useState(value);
  if (saved !== value) {
    setSaved(value);
    setDraft(value);
  }
  const box = useRef<HTMLSpanElement>(null);
  const p = clockParts(draft);
  const set = (part: Partial<ClockParts>) => {
    const v = clockValue({ ...p, ...part });
    setDraft(v);
    onChange?.(v);
  };
  const blur = () => {
    if (!onCommit) return;
    // Wait for focus to land, so moving between the three parts doesn't count as leaving.
    requestAnimationFrame(() => {
      if (!box.current?.contains(document.activeElement) && draft !== value) onCommit(draft);
    });
  };

  return (
    <span className="tpick" role="group" aria-label={label} ref={box} onBlur={blur}>
      <select aria-label="Hour" value={p.hour} onChange={(e) => set({ hour: Number(e.target.value) })}>
        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span aria-hidden="true">:</span>
      <select aria-label="Minute" value={p.minute} onChange={(e) => set({ minute: Number(e.target.value) })}>
        {minuteChoices(p.minute).map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
      </select>
      <select aria-label="am or pm" value={p.pm ? 'pm' : 'am'} onChange={(e) => set({ pm: e.target.value === 'pm' })}>
        <option value="am">am</option>
        <option value="pm">pm</option>
      </select>
    </span>
  );
}
