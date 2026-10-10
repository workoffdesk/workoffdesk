import { useEffect, useState } from 'react';

// The time now, moving each second while `on`.
export function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const every = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(every);
  }, [on]);
  return now;
}
