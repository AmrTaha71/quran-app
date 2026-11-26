// 15.11: renders nothing; checks the review reminder each minute (web) and
// re-plans the native week once on start.
import { useEffect } from 'react';
import { reviewReminderTick, replanReviewReminder } from '../lib/reviewReminder';

export default function ReviewReminderWatcher() {
  useEffect(() => {
    replanReviewReminder();
    reviewReminderTick();
    const iv = window.setInterval(() => reviewReminderTick(), 60000);
    return () => window.clearInterval(iv);
  }, []);
  return null;
}
