import type { AddResult } from '../shared/api';
import { fmtTime, joinAnd, momentOn, relWord } from './format';

// The add box's result message (spec §11, "After adding"): exactly what happened, and whether the
// AI sorted it.

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : word.endsWith('s') ? 'es' : 's'}`;

/** Why some or all of it is a simple guess. */
function sortedBy(r: AddResult): string {
  if (!r.fellBack) return 'Sorted by AI.';
  const why = r.reason ? ` (${r.reason})` : '';
  if (r.fellBack === r.chunks) return `The AI wasn’t available, so this is a simple guess${why}.`;
  return `Part of this is a simple guess, because the AI didn’t answer for ${r.fellBack} of ${r.chunks} parts${why}.`;
}

/**
 * "Added “Get razor” to This week. Sorted by AI." for one item, or "Added 12 items: 8 tasks,
 * 2 routines, and 2 events." for several. `labels` names the task groups.
 */
export function addMessage(r: AddResult, today: string, zone: string, labels: Record<string, string>): string {
  const n = r.added.length;
  if (!n) return `Couldn’t find anything to add in that.${r.fellBack && r.reason ? ` (The AI wasn’t available: ${r.reason}.)` : ''}`;

  let what: string;
  if (n === 1) {
    const a = r.added[0]!;
    switch (a.kind) {
      case 'task':
        what = `Added “${a.title}” to ${labels[a.window] ?? a.window}.`;
        break;
      case 'sometime':
        what = `Added “${a.title}” to Sometime ${relWord(today, a.date)}.`;
        break;
      case 'event': {
        const at = momentOn(a.startAt, zone);
        what = `Added “${a.title}” ${relWord(today, at.date)} at ${fmtTime(at.min)}.`;
        break;
      }
      default:
        what = `Added the ${a.kind} “${a.title}”.`;
    }
  } else {
    const counts = new Map<string, number>();
    for (const a of r.added) {
      const k = a.kind === 'sometime' ? 'task' : a.kind;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const parts = ['task', 'routine', 'event', 'class'].filter((k) => counts.has(k)).map((k) => plural(counts.get(k)!, k));
    what = `Added ${n} items: ${joinAnd(parts)}.`;
  }
  return `${what} ${sortedBy(r)}`;
}
