import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { secondsRemaining } from './resend';

/**
 * Seconds left before a new code can be requested.
 *
 * Derived from a wall-clock deadline rather than counted down tick by tick
 * (AKIBA-MOB-001 §2 "Preserve the flow when the app backgrounds and
 * returns"): both platforms throttle timers in the background, so a
 * decrementing counter comes back wrong — re-reading the deadline is
 * correct no matter how long the app was away. The AppState listener only
 * makes that correction immediate instead of waiting for the next tick.
 */
export function useResendCountdown(availableAt: number): number {
  const [remaining, setRemaining] = useState(() => secondsRemaining(availableAt));

  useEffect(() => {
    function sync() {
      setRemaining(secondsRemaining(availableAt));
    }

    sync();
    const timer = setInterval(sync, 500);
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') sync();
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [availableAt]);

  return remaining;
}
