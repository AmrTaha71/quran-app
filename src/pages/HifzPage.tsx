// الحفظ as a real route (#/hifz). Thin wrapper over the existing view.
import HomeHifzView from '../components/home/HomeHifzView';
import type { Route } from '../lib/routes';

export default function HifzPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
  return <HomeHifzView onNavigate={onNavigate} onClose={() => onNavigate('home')} />;
}
