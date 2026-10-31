import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { hasAnyFullDownload } from '../lib/pageDownload';

// Offline notice: shows on every page while the device is offline, so
// the user understands why fresh content (search, AI, new pages) fails
// while previously visited Mushaf pages still open from the cache.
// Copy is honest about full downloads: when the user has downloaded
// any edition to the device, THOSE pages are available offline in
// full — not just pages visited before (the old copy claimed
// visited-only even for full-download users). Note: navigator.onLine
// cannot detect captive portals (a "connected" portal still blocks
// fetches), so the banner only claims what offline state implies.
export default function OfflineBanner() {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [hasDownload, setHasDownload] = useState(false);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => {
      setOnline(false);
      // Refresh the download check when going offline: the user may
      // have downloaded pages since the banner last mounted.
      void hasAnyFullDownload().then(setHasDownload).catch(() => {});
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    void hasAnyFullDownload().then(setHasDownload).catch(() => {});
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  if (online) return null;
  return (
    <div className="fixed top-0 right-0 left-0 z-[200] bg-amber-700 text-white text-center text-sm font-semibold py-2 pt-[calc(0.5rem_+_env(safe-area-inset-top))] px-4 flex items-center justify-center gap-2 pointer-events-none">
      <WifiOff className="w-4 h-4 flex-shrink-0" />
      {hasDownload
        ? 'لا يوجد اتصال بالإنترنت — الصفحات المحمّلة على جهازك متاحة بالكامل، وأي صفحة أخرى زرتها من قبل متاحة أيضاً'
        : 'لا يوجد اتصال بالإنترنت — الصفحات التي زرتها من قبل فقط هي المتاحة'}
    </div>
  );
}
