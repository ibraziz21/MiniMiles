import { useEffect } from 'react';
import { usePathname } from 'expo-router';

import { trackScreen } from './track';

/** Records a screen view each time the route changes. Mounted once, at the root. */
export function useScreenTracking() {
  const pathname = usePathname();
  useEffect(() => {
    trackScreen(pathname);
  }, [pathname]);
}
