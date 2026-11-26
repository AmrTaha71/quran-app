// 15.9 (phase 6): «أسئلة الحفظ» — the classic teacher questions on the
// user's range: next / previous ayah, the missing word, order the ayat, how a
// page starts, how a juz starts. Ranges: surah, juz or ربع حزب. With a
// declared «محفوظي» the questions come from it only. Multiple choice; a
// round is 10 questions; the score goes to the score log as «أسئلة».
import { useEffect, useMemo, useState } from 'react';
import { X, Check } from 'lucide-react';
import DrumSelect from './DrumSelect';
import { SURAHS } from '../lib/surahs';
import { rangeOf, fromGlobal, type RangeScope } from '../lib/comprehensiveTest';
import { loadQuranText, arNum, currentHistoryLevel } from '../lib/roundTest';
import { loadHifzCorpus } from '../lib/hifzCorpus';
import { MADINAH_PAGE_STARTS } from '../lib/madinahPageStarts';
import { JUZ_STARTS } from '../lib/quranBoundaries';
import { getGlobalAyahNumber } from '../lib/surahs';
import { makeQuestion, QUESTION_KINDS, type MemQ, type PoolAyah } from '../lib/memQuestions';
import { addTestHistoryV1 } from '../lib/testHistory';
import { useEscapeClose } from '../lib/useEscape';
import { playClap, playBuzz } from '../lib/gameSounds';

const ROUND = 10;
type Scope = Extract<RangeScope, 'surah' | 'juz' | 'quarter'>;
const SCOPES: [Scope, string][] = [['surah', 'سورة'], ['juz', 'جزء'], ['quarter', 'ربع حزب']];
const PAGE_STARTS_G = MADINAH_PAGE_STARTS.map((k) => getGlobalAyahNumber(Math.floor(k / 1000), k % 1000));
const JUZ_STARTS_G = JUZ_STARTS.map((j) => j.global);

export default function MemQuestionsModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState<Map<string, string> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void loadQuranText().then((t) => (t ? setText(t) : setFailed(true))); }, []);
  const [scope, setScope] = useState<Scope>('juz');
  const [n, setN] = useState(30);
  const [kinds, setKinds] = useState<Set<MemQ['kind']>>(new Set(QUESTION_KINDS.map((k) => k.id)));
  const [qs, setQs] = useState<MemQ[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [tapped, setTapped] = useState<number[]>([]);
  const [right, setRight] = useState<boolean[]>([]);
  const [msg, setMsg] = useState('');
  useEscapeClose(true, onClose);
  const corpus = useMemo(() => loadHifzCorpus(), []);
  const max = scope === 'surah' ? 114 : scope === 'juz' ? 30 : 240;

  const start = () => {
    if (!text) return;
    const r = rangeOf(scope, n);
    const pool: PoolAyah[] = [];
    for (let g = r.start; g < r.end; g++) {
      if (corpus && !corpus.has(g)) continue;
      const p = fromGlobal(g);
      const t = text.get(`${p.s}:${p.a}`);
      if (t) pool.push({ g, s: p.s, a: p.a, text: t });
    }
    const ctx = { pageStarts: PAGE_STARTS_G, juzStarts: JUZ_STARTS_G, textOf: (g: number) => { const p = fromGlobal(g); return text.get(`${p.s}:${p.a}`); } };
    const want = QUESTION_KINDS.map((k) => k.id).filter((k) => kinds.has(k));
    const out: MemQ[] = [];
    for (let tries = 0; out.length < ROUND && tries < ROUND * 8; tries++) {
      const q = makeQuestion(want[tries % want.length], pool, ctx);
      if (q) out.push(q);
    }
    if (out.length === 0) { setMsg(corpus ? 'مفيش أسئلة من محفوظك في النطاق ده. اختار نطاق فيه آيات علّمتها «حفظتها».' : 'النطاق ده صغير على الأسئلة دي. اختار نطاق أكبر أو أنواع تانية.'); return; }
    setMsg(''); setQs(out); setIdx(0); setPicked(null); setTapped([]); setRight([]);
  };

  const q = qs?.[idx];
  const answered = q ? (q.kind === 'order' ? tapped.length === q.items.length : picked !== null) : false;
  const finished = !!qs && idx >= qs.length;

  const answer = (i: number) => {
    if (!q || q.kind === 'order' || picked !== null) return;
    setPicked(i);
    const ok = i === q.answer;
    if (ok) playClap(); else playBuzz();
    setRight((r) => [...r, ok]);
  };
  const tap = (i: number) => {
    if (!q || q.kind !== 'order' || tapped.includes(i)) return;
    const next = [...tapped, i];
    setTapped(next);
    if (next.length === q.items.length) {
      const ok = next.every((v, k) => v === q.order[k]);
      if (ok) playClap(); else playBuzz();
      setRight((r) => [...r, ok]);
    }
  };
  const next = () => {
    if (!qs) return;
    const ni = idx + 1;
    setIdx(ni); setPicked(null); setTapped([]);
    if (ni >= qs.length) {
      const score = right.filter(Boolean).length;
      addTestHistoryV1({
        ts: new Date().toISOString(), level: currentHistoryLevel(),
        score: Math.round((score / qs.length) * 100), correct: score, attempted: qs.length,
        completed: true, mode: 'ayah', ear: 'manual',
        label: `أسئلة — ${scope === 'surah' ? `سورة ${SURAHS[n - 1]?.name ?? ''}` : scope === 'juz' ? `الجزء ${arNum(n)}` : `الربع ${arNum(n)}`}`,
        kind: 'questions',
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-end md:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="أسئلة الحفظ">
      <div dir="rtl" className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-ink font-display-ar">أسئلة الحفظ</h2>
          <button onClick={onClose} aria-label="إغلاق" className="p-2 rounded-full bg-black/5"><X className="w-5 h-5" /></button>
        </div>
        {!qs && (
          <>
            <p className="text-sm text-ink-2">أسئلة زي ما المحفّظ بيسأل، من النطاق اللي تختاره{corpus ? ' ومن محفوظك بس' : ''}.</p>
            <div className="grid grid-cols-3 gap-2">
              {SCOPES.map(([k, label]) => (
                <button key={k} type="button" onClick={() => { setScope(k); setN(1); }}
                  className={`min-h-[44px] rounded-xl text-sm font-bold ${scope === k ? 'grad-emerald-door text-white' : 'bg-white text-ink-2 border border-hairline-emerald'}`}>{label}</button>
              ))}
            </div>
            <DrumSelect label={SCOPES.find((s) => s[0] === scope)![1]} value={Math.min(n, max)} onChange={setN}
              options={Array.from({ length: max }, (_, i) => ({ value: i + 1, label: scope === 'surah' ? `${i + 1}. ${SURAHS[i].name}` : arNum(i + 1) }))} />
            <div className="grid grid-cols-2 gap-2">
              {QUESTION_KINDS.map((k) => {
                const on = kinds.has(k.id);
                return (
                  <button key={k.id} type="button" aria-pressed={on}
                    onClick={() => setKinds((s) => { const t = new Set(s); if (on && t.size > 1) t.delete(k.id); else t.add(k.id); return t; })}
                    className={`min-h-[44px] rounded-xl text-sm font-semibold border flex items-center justify-center gap-1 ${on ? 'bg-emerald-50 border-emerald-600 text-emerald-800' : 'bg-white border-hairline text-ink-2'}`}>
                    {on && <Check className="w-4 h-4" />}{k.label}
                  </button>
                );
              })}
            </div>
            {failed && <p className="text-sm text-amber-800">ما قدرناش نجيب نص المصحف (النت؟). جرّب تاني.</p>}
            {msg && <p className="text-sm text-amber-800">{msg}</p>}
            <button type="button" onClick={start} disabled={!text} className="w-full min-h-[52px] grad-emerald-door text-white font-bold rounded-xl disabled:opacity-40 polish-press">ابدأ ({arNum(ROUND)} أسئلة)</button>
          </>
        )}
        {q && !finished && (
          <>
            <p className="text-sm text-ink-2">السؤال {arNum(idx + 1)} من {arNum(qs!.length)}</p>
            <p className="text-lg font-bold text-ink">{q.prompt}</p>
            {q.kind !== 'order' && q.shown && <p className="text-xl leading-loose font-arabic bg-gray-50 rounded-xl p-3">{q.shown}</p>}
            {q.kind === 'order' ? (
              <div className="space-y-2">
                {q.items.map((it, i) => {
                  const pos = tapped.indexOf(i);
                  const done = tapped.length === q.items.length;
                  const good = done && q.order[pos] === i;
                  return (
                    <button key={i} type="button" onClick={() => tap(i)}
                      className={`w-full text-right rounded-xl border p-3 text-lg font-arabic leading-loose ${pos < 0 ? 'bg-white border-hairline' : done ? (good ? 'bg-emerald-50 border-emerald-600' : 'bg-amber-50 border-amber-500') : 'bg-emerald-50 border-emerald-300'}`}>
                      {pos >= 0 && <span className="font-bold text-emerald-800 ml-2">{arNum(pos + 1)}</span>}{it}
                    </button>
                  );
                })}
                {tapped.length > 0 && tapped.length < q.items.length && <button type="button" onClick={() => setTapped([])} className="text-sm text-emerald-700 underline">ابدأ الترتيب من الأول</button>}
              </div>
            ) : (
              <div className="space-y-2">
                {q.options.map((o, i) => (
                  <button key={i} type="button" onClick={() => answer(i)}
                    className={`w-full text-right rounded-xl border p-3 text-lg font-arabic leading-loose ${picked === null ? 'bg-white border-hairline' : i === q.answer ? 'bg-emerald-50 border-emerald-600' : i === picked ? 'bg-amber-50 border-amber-500' : 'bg-white border-hairline opacity-60'}`}>
                    {o}
                  </button>
                ))}
              </div>
            )}
            {answered && (
              <button type="button" onClick={next} className="w-full min-h-[52px] grad-emerald-door text-white font-bold rounded-xl polish-press">
                {idx + 1 < qs!.length ? 'اللي بعده' : 'النتيجة'}
              </button>
            )}
          </>
        )}
        {finished && (
          <div className="text-center space-y-3 py-2">
            <p className="text-2xl font-bold text-ink">خلصت</p>
            <p className="text-lg text-ink-2">جبت {arNum(right.filter(Boolean).length)} من {arNum(qs!.length)}</p>
            <button type="button" onClick={start} className="w-full min-h-[52px] grad-emerald-door text-white font-bold rounded-xl">جولة تانية</button>
            <button type="button" onClick={() => setQs(null)} className="w-full min-h-[48px] bg-white border-2 border-emerald-700 text-emerald-800 font-bold rounded-xl">غيّر النطاق</button>
          </div>
        )}
      </div>
    </div>
  );
}
