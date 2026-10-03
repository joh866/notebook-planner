// Classes are never deadlines (spec §6 and §11). A task can be due at a class's start ("before
// class"), but its deadline is named for the work, never for the class.

export interface ClassName {
  /** "ECON 20010". */
  code: string;
  /** "Lecture", "Discussion". */
  kind: string;
}

/** Words that only say "a class meeting". */
const MEETING = new Set(['lecture', 'lectures', 'class', 'classes', 'discussion', 'section', 'seminar', 'lab', 'meeting', 'the', 'next', 'my', 'a', 'before', 'at', 'of']);

/**
 * True when the words only name a class: "ECON lecture", "ECON 20010", "the next Math class". A
 * name that says what the work is ("Math PSet 1", "Econ reading") isn't a class.
 */
export function namesClass(text: string, classes: ClassName[]): boolean {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return false;
  const subjects = new Set<string>();
  const numbers = new Set<string>();
  const kinds = new Set<string>();
  for (const c of classes) {
    const [subject, number] = c.code.toLowerCase().split(/\s+/);
    if (subject) subjects.add(subject);
    if (number) numbers.add(number);
    for (const k of c.kind.toLowerCase().split(/\s+/)) kinds.add(k);
  }
  if (!words.some((w) => subjects.has(w))) return false;
  return words.every((w) => subjects.has(w) || numbers.has(w) || kinds.has(w) || MEETING.has(w));
}

/** The name a task's deadline goes by: its short name, unless that only names a class. */
export function deadlineName(task: { title: string; shortName: string | null }, classes: ClassName[]): string {
  return task.shortName && !namesClass(task.shortName, classes) ? task.shortName : task.title;
}
