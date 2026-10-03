import type { LogResult } from '../shared/api';
import { cap, fmtRange, fmtTime, momentOn, relWord } from './format';

// The message after reporting time (spec §11, "After adding"): it lists every change.

/** "Marked “Read The Muqaddimah” done, 3:46–5:08pm (82 min). Ended RSO fair at 3:46pm." */
export function logMessage(r: LogResult, today: string, zone: string): string {
  const from = momentOn(r.session.startAt, zone);
  const to = momentOn(r.block?.endAt ?? r.session.endAt ?? r.session.startAt, zone);
  const day = from.date === today ? '' : `${relWord(today, from.date)} `;
  const when = `${day}${fmtRange(from.min, from.date === to.date ? to.min : to.min + 1440)}`;
  const head = r.done
    ? `Marked “${r.title}” done, ${when} (${r.minutes} min).`
    : `Logged ${r.minutes} min on “${r.title}”, ${when}.`;
  const cuts = r.trimmed.map((x) => ` Ended ${x.title} at ${fmtTime(momentOn(x.endAt, zone).min)}.`).join('');
  return cap(head) + cuts;
}
