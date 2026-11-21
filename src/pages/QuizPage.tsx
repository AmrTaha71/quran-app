// اختبر نفسك as a real route (#/quiz). Owns the three quiz modals that used
// to live in the Home page.
import { useState } from 'react';
import HomeQuizView from '../components/home/HomeQuizView';
import MutashabihatGame from '../components/MutashabihatGame';
import TarteelQuizModal from '../components/TarteelQuizModal';
import ComprehensiveTestModal from '../components/ComprehensiveTestModal';
import type { Route } from '../lib/routes';

export default function QuizPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const [mutOpen, setMutOpen] = useState(false);
  const [tarteelOpen, setTarteelOpen] = useState(false);
  const [comprehensiveOpen, setComprehensiveOpen] = useState(false);
  return (
    <>
      <HomeQuizView onNavigate={onNavigate} onClose={() => onNavigate('home')}
        onTarteel={() => setTarteelOpen(true)} onMutashabihat={() => setMutOpen(true)} onComprehensive={() => setComprehensiveOpen(true)} />
      {mutOpen && <MutashabihatGame onClose={() => setMutOpen(false)} />}
      {tarteelOpen && <TarteelQuizModal onClose={() => setTarteelOpen(false)} />}
      {comprehensiveOpen && <ComprehensiveTestModal onClose={() => setComprehensiveOpen(false)} />}
    </>
  );
}
