import { useEffect, useState } from 'react';

export function useRetryAfter() {
  const [deadline, setDeadline] = useState(0);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
      setSeconds(remaining);
      if (!remaining) window.clearInterval(timer);
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [deadline]);

  function start(secondsToWait: number) {
    setSeconds(secondsToWait);
    setDeadline(Date.now() + secondsToWait * 1_000);
  }

  return { seconds, start };
}
