import { useEffect, useState } from 'react';

/** Matches the phone rules in styles.css. */
export const PHONE_QUERY = '(max-width:700px)';

/** True at phone width (spec §5, "Phone"). */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const change = () => setPhone(mq.matches);
    mq.addEventListener('change', change);
    return () => mq.removeEventListener('change', change);
  }, []);
  return phone;
}
