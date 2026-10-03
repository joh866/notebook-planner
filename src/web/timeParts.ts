// The 12-hour time picker's parts (spec §4). The browser's own time input follows the computer's
// 24-hour setting, so the app uses its own: hour, minute, and am or pm. Values stay "HH:mm".

export interface ClockParts {
  /** 1–12. */
  hour: number;
  minute: number;
  pm: boolean;
}

export function clockParts(hhmm: string): ClockParts {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return { hour: h % 12 || 12, minute: m, pm: h >= 12 };
}

export function clockValue({ hour, minute, pm }: ClockParts): string {
  const h = (hour % 12) + (pm ? 12 : 0);
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Every 5 minutes, plus the current minute when it's in between. */
export function minuteChoices(current: number): number[] {
  const out = Array.from({ length: 12 }, (_, i) => i * 5);
  if (!out.includes(current)) out.push(current);
  return out.sort((a, b) => a - b);
}
