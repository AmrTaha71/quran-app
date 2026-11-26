import { useEffect, useState } from 'react';

// 6.12 (2026-11-26): state read from storage, read again whenever the
// page comes back (window focus / tab visible). Home can stay mounted
// while the user tests elsewhere; without this a card keeps the numbers
// from when it first opened. Same pattern RecentlyRow always used.
export function useReadOnReturn<T>(read: () => T): T {
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') setValue(read()); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
    // `read` is a stable module function at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}
