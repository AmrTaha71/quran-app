import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

// Offline notice: shows on every page while the device is offline, so
// the user understands why fresh content (search, AI, new pages) fails
// while previously visited Mushaf pages still open from the cache.
export default function OfflineBanner() {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  if (online) return null;
  return (
    <div className="fixed top-0 right-0 left-0 z-[200] bg-amber-500 text-white text-center text-sm font-bold py-2 px-4 flex items-center justify-center gap-2 pointer-events-none">
      <WifiOff className="w-4 h-4 flex-shrink-0" />
      لا يوجد اتصال بالإنترنت — الصفحات التي زرتها من قبل فقط هي المتاحة
    </div>
  );
}
