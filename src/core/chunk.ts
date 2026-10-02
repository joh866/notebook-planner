// Long pastes are split into chunks of about 12 lines along paragraph breaks, so the AI can sort
// them in parallel (spec §11, "Long input").

export const CHUNK_LINES = 12;

/**
 * A header line applies to the lines under it ("10/6 (Tuesday)", "SOSC 16100", "(before 2:00pm)",
 * "Category: Homework", "Today:"). A chunk shouldn't end on one.
 */
export function isHeaderLine(line: string): boolean {
  const s = line.trim();
  if (/^[-•*]/.test(s)) return false;
  return (
    /^\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(s) ||
    /^[A-Z]{2,5}\s?\d{4,5}$/.test(s) ||
    /^\([^)]*\)$/.test(s) ||
    /^[^:]{1,30}:\s*$/.test(s) ||
    /^category\s*:/i.test(s)
  );
}

/**
 * Splits text into chunks of at most `size` lines. Paragraphs stay together when they fit. A long
 * paragraph is cut before a run of header lines, so a date and its course stay with the items
 * under them.
 */
export function chunkText(text: string, size = CHUNK_LINES): string[] {
  const paras = text
    .replace(/^\uFEFF/, '')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((p) => p.length);

  // A chunk keeps the blank line between its paragraphs, since a blank line ends a header's reach.
  const chunks: string[] = [];
  let cur: string[][] = [];
  const lines = () => cur.reduce((n, p) => n + p.length, 0);
  const flush = () => {
    if (cur.length) chunks.push(cur.map((p) => p.join('\n')).join('\n\n'));
    cur = [];
  };

  for (const p of paras) {
    let rest = p;
    if (cur.length && lines() + rest.length > size) flush();
    while (rest.length > size) {
      // Cut before the header run that starts latest within the first `size` lines.
      let cut = size;
      for (let i = size; i > 1; i--) {
        if (isHeaderLine(rest[i]!) && !isHeaderLine(rest[i - 1]!)) {
          cut = i;
          break;
        }
      }
      chunks.push(rest.slice(0, cut).join('\n'));
      rest = rest.slice(cut);
    }
    cur.push(rest);
  }
  flush();
  return chunks;
}
