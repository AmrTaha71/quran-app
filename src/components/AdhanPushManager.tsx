// Silent push-subscription keeper. Mounted once in App next to
// AdhanScheduler. On launch and whenever the app returns to the
// foreground it re-stores the existing push subscription with the
// current adhan location/timezone (see syncAdhanPushSubscription in
// lib/adhanPush). It never asks for permission and never subscribes
// on its own — subscribing happens only from the Settings toggle,
// which is a user gesture. Renders nothing.
import { useEffect } from 'react';
import { syncAdhanPushSubscription } from '../lib/adhanPush';

export default function AdhanPushManager() {
  useEffect(() => {
    void syncAdhanPushSubscription();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncAdhanPushSubscription();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  return null;
}
