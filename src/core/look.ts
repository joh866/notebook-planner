export type Look = 'day' | 'night';
export type LookSetting = 'auto' | Look;

/** Night runs from 8pm to 8am local time (spec §4). `hour` is the local hour, 0–23. */
export function lookForHour(hour: number, setting: LookSetting = 'auto'): Look {
  if (setting !== 'auto') return setting;
  return hour >= 20 || hour < 8 ? 'night' : 'day';
}
