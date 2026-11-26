// اختبر نفسك as a real route (#/quiz). Owns the quiz modals (the three that used
// to live in the Home page, plus «أسئلة الحفظ» 15.9 and «اختبار كتابي» 16.2).
import { useState } from 'react';
import HomeQuizView from '../components/home/HomeQuizView';
import MutashabihatGame from '../components/MutashabihatGame';
import TarteelQuizModal from '../components/TarteelQuizModal';
import ComprehensiveTestModal from '../components/ComprehensiveTestModal';
import WrittenTestModal from '../components/WrittenTestModal';
import MemQuestionsModal from '../components/MemQuestionsModal';
import type { Route } from '../lib/routes';

export default function QuizPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const [mutOpen, setMutOpen] = useState(false);
  const [tarteelOpen, setTarteelOpen] = useState(false);
  const [comprehensiveOpen, setComprehensiveOpen] = useState(false);
  const [writtenOpen, setWrittenOpen] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  return (
    <>
      <HomeQuizView onNavigate={onNavigate} onClose={() => onNavigate('home')}
        onTarteel={() => setTarteelOpen(true)} onMutashabihat={() => setMutOpen(true)} onComprehensive={() => setComprehensiveOpen(true)}
        onWritten={() => setWrittenOpen(true)} onQuestions={() => setQuestionsOpen(true)} />
      {mutOpen && <MutashabihatGame onClose={() => setMutOpen(false)} />}
      {tarteelOpen && <TarteelQuizModal onClose={() => setTarteelOpen(false)} />}
      {comprehensiveOpen && <ComprehensiveTestModal onClose={() => setComprehensiveOpen(false)} />}
      {writtenOpen && <WrittenTestModal onClose={() => setWrittenOpen(false)} />}
      {questionsOpen && <MemQuestionsModal onClose={() => setQuestionsOpen(false)} />}
    </>
  );
}
