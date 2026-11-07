// المشابهات (Quranpedia "similar") and أسباب النزول (Quranpedia "asbab"),
// shown as two tabs in the ayah popup. Data is bundled per surah under
// public/similar/{surah}.json and public/asbab/{surah}.json, loaded once.
// Source: quranpedia.net (free to use in apps, link appreciated).
import { useEffect, useState } from 'react';
import { SURAHS } from '../lib/surahs';
import { getQuranTextCache, type CachedTextRow } from '../lib/quranTextCache';

type Ref = { s: number; a: number };
type SimilarGroup = { n: string; v: Ref[] };
type SimilarEntry = { a: number; g: SimilarGroup[] };
type AsbabItem = { n: string | null; c: string | null; au: string | null; y: string | number | null; p: number | null; f: number | null; img: number | null };
type AsbabEntry = { a: number; b: AsbabItem[] };

const cache = new Map<string, Promise<unknown[]>>();
function loadJson<T>(path: string): Promise<T[]> {
  let p = cache.get(path);
  if (!p) {
    p = fetch(path).then((r) => { if (!r.ok) throw new Error('bad status'); return r.json() as Promise<unknown[]>; });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p as Promise<T[]>;
}

let textRows: Promise<Map<string, string> | null> | null = null;
function loadTextMap(): Promise<Map<string, string> | null> {
  if (!textRows) {
    textRows = getQuranTextCache().getAll(6000).then((rows: CachedTextRow[] | null) => {
      if (!rows) return null;
      const m = new Map<string, string>();
      for (const r of rows) m.set(`${r.surah_no}:${r.ayah_no}`, r.ayah_text);
      return m;
    }).catch(() => null);
  }
  return textRows;
}

function useLoaded<T>(path: string, surah: number, ayah: number, pick: (items: T[]) => T | undefined) {
  const [state, setState] = useState<{ entry: T | null; error: boolean; loaded: boolean }>({ entry: null, error: false, loaded: false });
  useEffect(() => {
    let alive = true;
    setState({ entry: null, error: false, loaded: false });
    loadJson<T>(path)
      .then((items) => { if (alive) setState({ entry: pick(items) ?? null, error: false, loaded: true }); })
      .catch(() => { if (alive) setState({ entry: null, error: true, loaded: true }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, surah, ayah]);
  return state;
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-6">
      <div className="w-7 h-7 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
    </div>
  );
}

const surahName = (n: number) => SURAHS.find((x) => x.no === n)?.name ?? `سورة ${n}`;

export function AyahSimilar({ surah, ayah }: { surah: number; ayah: number }) {
  const st = useLoaded<SimilarEntry>(`/similar/${surah}.json`, surah, ayah, (items) => items.find((x) => x.a === ayah));
  const [text, setText] = useState<Map<string, string> | null>(null);
  useEffect(() => { loadTextMap().then(setText); }, []);

  if (!st.loaded) return <Spinner />;
  if (st.error) return <p className="text-center py-6 text-accent-600">تعذر تحميل المشابهات الآن — حاول مجدداً</p>;
  if (!st.entry || st.entry.g.length === 0) return <p className="text-center py-6 text-accent-600">مفيش آيات مشابهة مسجلة للآية دي في المصدر.</p>;

  return (
    <div className="space-y-3">
      {st.entry.g.map((grp, i) => (
        <div key={i} className="bg-gray-50 rounded-lg p-3 border border-emerald-100">
          {grp.n && <p className="text-sm font-bold text-accent-700 mb-2">{grp.n}</p>}
          <div className="space-y-2">
            {grp.v.map((r, j) => (
              <div key={j} className="bg-white rounded-lg p-2 border border-emerald-200">
                <p className="text-sm font-bold text-accent-700">{surahName(r.s)} — آية {r.a}</p>
                {text?.get(`${r.s}:${r.a}`) && (
                  <p className="font-arabic text-lg text-accent-800 leading-loose">{text.get(`${r.s}:${r.a}`)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-accent-600 text-center">
        المصدر: <a href="https://quranpedia.net" target="_blank" rel="noreferrer" className="underline">الموسوعة القرآنية quranpedia.net</a>
      </p>
    </div>
  );
}

export function AyahAsbab({ surah, ayah }: { surah: number; ayah: number }) {
  const st = useLoaded<AsbabEntry>(`/asbab/${surah}.json`, surah, ayah, (items) => items.find((x) => x.a === ayah));
  if (!st.loaded) return <Spinner />;
  if (st.error) return <p className="text-center py-6 text-accent-600">تعذر تحميل أسباب النزول الآن — حاول مجدداً</p>;
  if (!st.entry || st.entry.b.length === 0) return <p className="text-center py-6 text-accent-600">مفيش أسباب نزول مسجلة للآية دي في المصدر.</p>;

  return (
    <div className="space-y-2">
      {st.entry.b.map((it, i) => (
        <div key={i} className="bg-gray-50 rounded-lg p-3 border border-emerald-100">
          <p className="text-sm font-bold text-accent-800">{it.n}</p>
          <p className="text-xs text-accent-600 mt-1">
            {[it.c, it.au, it.y ? String(it.y) : null, it.p ? `${it.p} جزء` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
      ))}
      <p className="text-xs text-accent-600 text-center">
        المصدر: <a href="https://quranpedia.net" target="_blank" rel="noreferrer" className="underline">الموسوعة القرآنية quranpedia.net</a>
      </p>
    </div>
  );
}
