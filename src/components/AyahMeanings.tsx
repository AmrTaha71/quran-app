// معاني الكلمات (2026-11-07): word meanings for one ayah, from the
// Quranpedia "غريب القرآن" dataset. Free to use inside apps, no
// attribution required (a link is appreciated). Data is split per
// surah under public/meanings/{surah}.json and loaded on demand.
import { useEffect, useState } from 'react';

interface WordMeaning { t: string; m: string }
interface BookMeaning { name: string; author: string; words: WordMeaning[] }
interface AyahMeaningEntry { ayah: number; books: BookMeaning[] }

const surahCache = new Map<number, Promise<AyahMeaningEntry[]>>();

function loadSurah(surah: number): Promise<AyahMeaningEntry[]> {
  let p = surahCache.get(surah);
  if (!p) {
    p = fetch(`/meanings/${surah}.json`).then((r) => {
      if (!r.ok) throw new Error('bad status');
      return r.json() as Promise<AyahMeaningEntry[]>;
    });
    // A failed load must not stay cached, so the next open retries.
    p.catch(() => surahCache.delete(surah));
    surahCache.set(surah, p);
  }
  return p;
}

export default function AyahMeanings({ surah, ayah }: { surah: number; ayah: number }) {
  const [books, setBooks] = useState<BookMeaning[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setBooks(null);
    setError(false);
    loadSurah(surah)
      .then((items) => {
        if (!alive) return;
        const entry = items.find((x) => x.ayah === ayah);
        setBooks(entry ? entry.books : []);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => { alive = false; };
  }, [surah, ayah]);

  if (error) {
    return <p className="text-center py-6 text-accent-600">تعذر تحميل معاني الكلمات الآن — تحقق من الاتصال وحاول مجدداً</p>;
  }
  if (books === null) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="w-7 h-7 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
      </div>
    );
  }
  if (books.length === 0) {
    return <p className="text-center py-6 text-accent-600">مفيش معاني كلمات مسجلة للآية دي في المصدر.</p>;
  }
  return (
    <div className="space-y-4">
      {books.map((b, i) => (
        <div key={i} className="bg-gray-50 rounded-lg p-3 border border-emerald-100">
          <p className="text-sm font-bold text-accent-800 mb-2">
            {b.name}{b.author ? <span className="font-normal text-accent-600"> — {b.author}</span> : null}
          </p>
          <ul className="space-y-2">
            {b.words.map((w, j) => (
              <li key={j} className="text-base leading-relaxed">
                <span className="font-arabic font-bold text-ink">{w.t}</span>
                <span className="text-accent-600"> : </span>
                <span className="text-accent-700">{w.m}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-xs text-accent-600 text-center">
        المصدر: <a href="https://quranpedia.net" target="_blank" rel="noreferrer" className="underline">الموسوعة القرآنية quranpedia.net</a>
      </p>
    </div>
  );
}
