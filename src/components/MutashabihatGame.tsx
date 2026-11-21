// "اختبر نفسك بالمتشابهات" (2026-11-07): the user sees a short phrase
// from the Quran and must name every ayah that contains it. Bank
// comes from src/data/mutashabihat-bank.json (built offline from the
// Quran text; see the generator notes in that file's sibling docs).
import { useEffect, useMemo, useState } from 'react';
import DrumSelect from './DrumSelect';
import { X } from 'lucide-react';
import BANK from '../data/mutashabihat-famous.json'; // 2026-11-07: only clues backed by two sources (Quranpedia similar groups)
import { SURAHS, SURAH_AYAH_COUNTS } from '../lib/surahs';
import { playClap, playCelebrate, playBuzz } from '../lib/gameSounds';
import { loadQuranText, HINT_COST, HINT_WORDS, MAX_HINTS, arNum } from '../lib/roundTest';
import { wordsAfterClue } from '../lib/mutHint';
import { MUT_ALL, bankInSpan, mutRangeLabel, mutSpan, type MutRange } from '../lib/mutRange';
import RangeVoiceButton from './RangeVoiceButton';

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
  const [range, setRange] = useState<MutRange>(MUT_ALL);
  const [queue, setQueue] = useState<BankItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [found, setFound] = useState<Set<string>>(new Set());
  const [mistakes, setMistakes] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  // W4-L «اديني كلمتين كمان»: words after the clue (per ayah), each request costs HINT_COST of the question.
  const [text, setText] = useState<Map<string, string> | null>(null);
  const [hintN, setHintN] = useState<Record<string, number>>({});
  const [qHints, setQHints] = useState(0);
  const [points, setPoints] = useState<number[]>([]);
  useEffect(() => { void loadQuranText().then(setText); }, []);
  const [surah, setSurah] = useState(1);
  const [ayah, setAyah] = useState('1');
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const current = queue[idx];
  // W4-M: the pool is the clues with at least one ayah inside the chosen range.
  const inRange = useMemo(() => bankInSpan(BANK as BankItem[], mutSpan(range)), [range]);
  const counts = useMemo(() => ({
    easy: inRange.filter((b) => b.level === 'easy').length,
    medium: inRange.filter((b) => b.level === 'medium').length,
    hard: inRange.filter((b) => b.level === 'hard').length,
  }), [inRange]);

  function startRound(lvl: Level) {
    const pool = inRange.filter((b) => b.level === lvl);
    setLevel(lvl);
    setQueue(shuffle(pool).slice(0, ROUND_SIZE));
    setIdx(0);
    setResults([]);
    setPoints([]);
    resetQuestion();
  }

  function resetQuestion() {
    setFound(new Set());
    setMistakes(0);
    setAyah('1');
    setFeedback(null);
    setHintN({});
    setQHints(0);
  }

  function moreWords() {
    if (!current || qHints >= MAX_HINTS) return;
    const k = current.answers.find((x) => !found.has(x));
    if (!k) return;
    const n = (hintN[k] ?? 0) + HINT_WORDS;
    if (!wordsAfterClue(current.clue, text?.get(k) ?? '', n)) { setFeedback({ ok: false, text: 'مفيش كلمات زيادة نديك إياها' }); return; }
    setHintN({ ...hintN, [k]: n });
    setQHints(qHints + 1);
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
    setAyah('1');
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
    const nextPoints = [...points, done ? Math.max(0, 1 - HINT_COST * qHints) : 0];
    setPoints(nextPoints);
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
            <div className="space-y-2 rounded-xl bg-gray-50 p-3">
              <p className="text-sm font-bold text-ink">النطاق: {mutRangeLabel(range)}</p>
              <div className="grid grid-cols-3 gap-2">
                {([['all', 'كل القرآن'], ['surah', 'سورة'], ['juz', 'جزء']] as const).map(([sc, label]) => (
                  <button key={sc} type="button" onClick={() => setRange(sc === 'all' ? MUT_ALL : { scope: sc, n: range.scope === sc ? range.n : 1 })}
                    className={`min-h-[44px] rounded-xl text-sm font-bold ${range.scope === sc ? 'grad-emerald-door text-white' : 'bg-white text-ink-2 border border-hairline-emerald'}`}>{label}</button>
                ))}
              </div>
              {range.scope === 'surah' && (
                <DrumSelect label="السورة" value={range.n} onChange={(n) => setRange({ scope: 'surah', n })} options={SURAHS.map((s) => ({ value: s.no, label: `${s.no}. ${s.name}` }))} />
              )}
              {range.scope === 'juz' && (
                <DrumSelect label="الجزء" value={range.n} onChange={(n) => setRange({ scope: 'juz', n })} options={Array.from({ length: 30 }, (_, i) => ({ value: i + 1, label: `الجزء ${arNum(i + 1)}` }))} />
              )}
              <RangeVoiceButton onRange={setRange} />
            </div>
            {LEVELS.map((l) => (
              <button key={l.id} onClick={() => startRound(l.id)} disabled={counts[l.id] === 0}
                className="w-full min-h-[56px] disabled:opacity-40 grad-emerald-door text-white font-bold rounded-xl text-lg polish-press">
                {l.label} <span className="text-sm opacity-80">({counts[l.id]} جملة)</span>
              </button>
            ))}
          </div>
        )}

        {level !== null && finished && (
          <div className="text-center space-y-4 py-4">
            <p className="text-2xl font-bold text-ink">خلصت الجولة</p>
            <p className="text-lg text-ink-2">جبت {results.filter(Boolean).length} من {results.length} من غير أخطاء</p>
            <p className="text-base text-ink-2">الدرجة: {arNum(Math.round(points.reduce((a, b) => a + b, 0) * 10) / 10)} من {arNum(results.length)} (كل «كلمتين كمان» بتخصم {arNum(HINT_COST * 100)}٪ من السؤال)</p>
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

            {current.answers.map((k, i) => (hintN[k] && !found.has(k)
              ? <p key={k} className="text-center font-display-ar text-lg text-amber-800">الآية {arNum(i + 1)}: … {wordsAfterClue(current.clue, text?.get(k) ?? '', hintN[k])}</p> : null))}
            {!solved && text && qHints < MAX_HINTS && (
              <button onClick={moreWords} className="w-full min-h-[44px] rounded-xl border border-amber-300 text-amber-800 font-bold">
                اديني كلمتين كمان <span className="text-xs font-normal">(بيخصم {arNum(HINT_COST * 100)}٪ من السؤال)</span>
              </button>
            )}
            {!solved && (
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <DrumSelect label="السورة" value={surah} onChange={setSurah} options={SURAHS.map((s) => ({ value: s.no, label: `${s.no}. ${s.name}` }))} />
                </div>
                <div className="w-32 shrink-0"><DrumSelect label="رقم الآية" value={Number(ayah) || 1} onChange={(n) => setAyah(String(n))}
                  options={Array.from({ length: SURAH_AYAH_COUNTS[surah - 1] || 1 }, (_, k) => ({ value: k + 1, label: `آية ${k + 1}` }))} /></div>
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
