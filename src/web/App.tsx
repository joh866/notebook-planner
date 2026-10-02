import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { dayOf } from '../core/day';
import { lookForHour } from '../core/look';

function useNow(): DateTime {
  const [now, setNow] = useState(() => DateTime.now());
  useEffect(() => {
    const id = setInterval(() => setNow(DateTime.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function fmtClock(t: DateTime): string {
  const h = t.hour % 12 || 12;
  const ap = t.hour < 12 ? 'am' : 'pm';
  return t.minute ? `${h}:${String(t.minute).padStart(2, '0')}${ap}` : `${h}${ap}`;
}

export function App() {
  const now = useNow();
  const look = lookForHour(now.hour);
  // Spec §3: before 4am counts as the previous night.
  const today = DateTime.fromISO(dayOf(now, now.zoneName ?? 'local'));

  useEffect(() => {
    document.body.dataset.mode = look;
  }, [look]);

  return (
    <div className="device">
      <header className="top">
        <div className="headrow">
          <div className="daterow">
            <h1>
              <span className="wide-only">{today.toFormat('cccc, LLLL d')}</span>
              <span className="phone-only">{today.toFormat('ccc, LLL d')}</span>
            </h1>
            <span className="clock">{fmtClock(now)}</span>
          </div>
        </div>
        <div className="rule"></div>
      </header>
    </div>
  );
}
