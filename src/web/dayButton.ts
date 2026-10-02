import type { KeyboardEvent } from 'react';
import { longDate } from './format';

/** Props that make an element open a day in the Day view on click, Enter, or Space (spec §5, §8). */
export function dayButton(date: string, open: (date: string) => void) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': `Open ${longDate(date)}`,
    onClick: () => open(date),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      open(date);
    },
  };
}
