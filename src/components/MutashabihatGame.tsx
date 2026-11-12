// "اختبر نفسك بالمتشابهات" (2026-11-07): the user sees a short phrase
// from the Quran and must name every ayah that contains it. Bank
// comes from src/data/mutashabihat-bank.json (built offline from the
// Quran text; see the generator notes in that file's sibling docs).
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import BANK from '../data/mutashabihat-famous.json'; // 2026-11-07: only clues backed by two sources (Quranpedia similar groups)
import { SURAHS, SURAH_AYAH_COUNTS } from '../lib/surahs';
import { playClap, playCelebrate, playBuzz } from '../lib/gameSounds';

type Level = 'easy' | 'medium' | 'hard';
interface BankItem { id: string; clue: string; answers: string[]; level: Level }

const LEVELS: { id: Level; label: string }[] = [
  { id: 'easy', label: 'سهل' },
  { id: 'medium', label: 'متوسط' },
  { id: 'hard', label: 'صعب' },
];
const ROUND_SIZE = 5;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 2026-11-12 (agreed UI rule): Arabic count forms, not "2 آيات".
export function countAyat(n: number): string {
  if (n === 1) return 'آية واحدة';
  if (n === 2) return 'آيتين';
  if (n >= 3 && n <= 10) return `${n} آيات`;
  return `${n} آية`;
}

export default function MutashabihatGame({ onClose }: { onClose: () => void }) {
  const [level, setLevel] = useState<Level | null>(null);
  const [queue, setQueue] = useState<BankItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [found, setFound] = useState<Set<string>>(new Set());
  const [mistakes, setMistakes] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [surah, setSurah] = useState(1);
  const [ayah, setAyah] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const current = queue[idx];
  const counts = useMemo(() => ({
    easy: (BANK as BankItem[]).filter((b) => b.level === 'easy').length,
    medium: (BANK as BankItem[]).filter((b) => b.level === 'medium').length,
    hard: (BANK as BankItem[]).filter((b) => b.level === 'hard').length,
  }), []);

  function startRound(lvl: Level) {
    const pool = (BANK as BankItem[]).filter((b) => b.level === lvl);
    setLevel(lvl);
    setQueue(shuffle(pool).slice(0, ROUND_SIZE));
    setIdx(0);
    setResults([]);
    resetQuestion();
  }

  function resetQuestion() {
    setFound(new Set());
    setMistakes(0);
    setAyah('');
    setFeedback(null);
  }

  function submit() {
    if (!current) return;
    const s = surah;
    const a = Number(ayah);
    const max = SURAH_AYAH_COUNTS[s - 1] ?? 0;
    if (!Number.isInteger(a) || a < 1 || a > max) {
      setFeedback({ ok: false, text: `اكتب رقم آية من 1 لـ ${max}` });
      return;
    }
    const key = `${s}:${a}`;
    if (found.has(key)) {
      setFeedback({ ok: false, text: 'الآية دي قلتها قبل كده' });
      return;
    }
    if (!current.answers.includes(key)) {
      setMistakes((m) => m + 1);
      playBuzz();
      setFeedback({ ok: false, text: 'لأ، الآية دي مش فيها الجملة دي' });
      return;
    }
    const next = new Set(found);
    next.add(key);
    setFound(next);
    setAyah('');
    if (next.size === current.answers.length) {
      playCelebrate();
      setFeedback({ ok: true, text: 'ممتاز! جبت الكل' });
    } else {
      playClap();
      setFeedback({ ok: true, text: `صح! فاضل ${current.answers.length - next.size}` });
    }
  }

  function nextQuestion() {
    const done = mistakes === 0 && found.size === (current?.answers.length ?? 0);
    const nextResults = [...results, done];
    if (idx + 1 >= queue.length) {
      setResults(nextResults);
      setQueue([]);
      setIdx(0);
      return;
    }
    setResults(nextResults);
    setIdx(idx + 1);
    resetQuestion();
  }

  const finished = level !== null && queue.length === 0 && results.length > 0;
  const solved = found.size === (current?.answers.length ?? 0) && !!current;

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-end md:items-center justify-center p-3" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold text-ink font-display-ar">اختبر نفسك بالمتشابهات</h2>
          <button onClick={onClose} aria-label="إغلاق" className="p-2 rounded-full bg-black/5"><X className="w-5 h-5" /></button>
        </div>

        {level === null && (
          <div className="space-y-3">
            <p className="text-ink-2 text-sm">هتشوف جملة من القرآن، ومطلوب منك تذكر كل الآيات اللي فيها الجملة دي.</p>
            {LEVELS.map((l) => (
              <button key={l.id} onClick={() => startRound(l.id)}
                className="w-full min-h-[56px] grad-emerald-door text-white font-bold rounded-xl text-lg polish-press">
                {l.label} <span className="text-sm opacity-80">({counts[l.id]} جملة)</span>
              </button>
            ))}
          </div>
        )}

        {level !== null && finished && (
          <div className="text-center space-y-4 py-4">
            <p className="text-2xl font-bold text-ink">خلصت الجولة</p>
            <p className="text-lg text-ink-2">جبت {results.filter(Boolean).length} من {results.length} من غير أخطاء</p>
            <button onClick={() => startRound(level)} className="w-full min-h-[52px] grad-emerald-door text-white font-bold rounded-xl polish-press">جولة تانية</button>
            <button onClick={() => setLevel(null)} className="w-full min-h-[48px] bg-white border-2 border-emerald-700 text-emerald-800 font-bold rounded-xl">غيّر المستوى</button>
          </div>
        )}

        {level !== null && !finished && current && (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">السؤال {idx + 1} من {queue.length}</p>
            <div className="rounded-xl bg-emerald-50 p-4 text-center">
              <p className="text-2xl leading-loose font-display-ar text-ink">{current.clue}</p>
            </div>
            <p className="text-ink font-semibold">الجملة دي في {countAyat(current.answers.length)}. سمّع كل آية.</p>

            <div className="flex flex-wrap gap-2 min-h-[32px]">
              {current.answers.map((k) => found.has(k) ? (
                <span key={k} className="px-3 py-1 rounded-full bg-emerald-600 text-white text-sm font-bold">{SURAHS[Number(k.split(':')[0]) - 1].name} {k.split(':')[1]}</span>
              ) : null)}
            </div>

            {!solved && (
              <div className="flex gap-2">
                <select value={surah} onChange={(e) => setSurah(Number(e.target.value))}
                  className="flex-1 min-h-[52px] rounded-xl border-2 border-emerald-700 px-2 text-base bg-white">
                  {SURAHS.map((s) => <option key={s.no} value={s.no}>{s.no}. {s.name}</option>)}
                </select>
                <input inputMode="numeric" value={ayah} onChange={(e) => setAyah(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                  placeholder="رقم الآية"
                  className="w-28 min-h-[52px] rounded-xl border-2 border-emerald-700 px-2 text-center text-lg bg-white" />
                <button onClick={submit} className="min-h-[52px] px-4 grad-emerald-door text-white font-bold rounded-xl polish-press">تحقق</button>
              </div>
            )}

            {feedback && (
              <p className={`text-center font-bold text-lg ${feedback.ok ? 'text-emerald-700' : 'text-red-700'}`}>{feedback.text}</p>
            )}

            {solved && (
              <button onClick={nextQuestion} className="w-full min-h-[52px] grad-emerald-door text-white font-bold rounded-xl polish-press">
                {idx + 1 >= queue.length ? 'شوف النتيجة' : 'السؤال اللي بعده'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
