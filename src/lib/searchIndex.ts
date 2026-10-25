// Session-cached, cross-rasm search over the whole Mushaf.
//
// Why client-side: Arabic normalization (see arabicNormalize) must
// apply to BOTH sides — the stored Uthmani text and the typed/imla'i
// query. Doing it in SQL would need new normalized columns, a
// backfill migration and a deploy/migration ordering window. Loading
// the verse + link texts once per session (the same pattern the
// mutashabihat tab already uses) and searching in memory avoids all
// of that, and makes every keystroke after the first load instant.
// Verse texts are ~6,236 short rows; approved links are far fewer.
//
// The caches are module-level promises: concurrent callers share one
// load, and a failed load clears itself so the next search retries.

import { supabase } from './supabase';
import { normalizeArabic } from './arabicNormalize';

export interface VerseIndexEntry {
  id: number;
  surah_no: number;
  surah_name: string;
  ayah_no: number;
  ayah_text: string;
  has_links: boolean | null;
  norm: string;
  normSurah: string;
}

export interface LinkIndexEntry {
  verse_id: number;
  link_types: string[];
  normContent: string;
  normTitle: string;
  normTranscript: string;
}

const PAGE = 1000;

let verseIndexPromise: Promise<VerseIndexEntry[]> | null = null;
let linkIndexPromise: Promise<LinkIndexEntry[]> | null = null;

export function loadVerseIndex(): Promise<VerseIndexEntry[]> {
  if (!verseIndexPromise) {
    verseIndexPromise = (async () => {
      const all: VerseIndexEntry[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from('quran_verses')
          .select('id, surah_no, surah_name, ayah_no, ayah_text, has_links')
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error || !data) throw error || new Error('failed to load verses');
        for (const v of data) {
          all.push({
            id: v.id,
            surah_no: v.surah_no,
            surah_name: v.surah_name,
            ayah_no: v.ayah_no,
            ayah_text: v.ayah_text,
            has_links: v.has_links,
            norm: normalizeArabic(v.ayah_text || ''),
            normSurah: normalizeArabic(v.surah_name || ''),
          });
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return all;
    })();
    verseIndexPromise.catch(() => {
      verseIndexPromise = null;
    });
  }
  return verseIndexPromise;
}

export function loadLinkIndex(): Promise<LinkIndexEntry[]> {
  if (!linkIndexPromise) {
    linkIndexPromise = (async () => {
      const all: LinkIndexEntry[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from('ayah_links')
          .select('verse_id, link_types, link_content, link_title, original_transcript')
          .eq('status', 'approved')
          .order('verse_id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error || !data) throw error || new Error('failed to load links');
        for (const l of data) {
          all.push({
            verse_id: l.verse_id,
            link_types: l.link_types || [],
            normContent: normalizeArabic(l.link_content || ''),
            normTitle: normalizeArabic(l.link_title || ''),
            normTranscript: normalizeArabic(l.original_transcript || ''),
          });
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return all;
    })();
    linkIndexPromise.catch(() => {
      linkIndexPromise = null;
    });
  }
  return linkIndexPromise;
}

export interface SearchFilters {
  surahNo?: number | null;
  linkType?: string | null;
  verseIds?: number[] | null;
  hasLinks?: boolean | null;
}

// Mirrors the old server search semantics, on normalized text:
// contiguous-phrase match first; if nothing matches and the query has
// 2+ words, fall back to ayahs/links containing ALL the words.
export function searchVerseIds(
  verses: VerseIndexEntry[],
  links: LinkIndexEntry[],
  query: string,
  filters: SearchFilters = {},
): number[] {
  const normQuery = normalizeArabic(query);
  if (!normQuery) return [];
  const words = normQuery.split(/\s+/).filter((w) => w.length > 0);

  const verseById = new Map(verses.map((v) => [v.id, v]));
  const verseIdsWithType = filters.linkType
    ? new Set(links.filter((l) => l.link_types.includes(filters.linkType as string)).map((l) => l.verse_id))
    : null;
  const allowedIds = filters.verseIds ? new Set(filters.verseIds) : null;

  const passesFilters = (verseId: number): boolean => {
    if (allowedIds && !allowedIds.has(verseId)) return false;
    const v = verseById.get(verseId);
    if (!v) return false;
    if (filters.surahNo && v.surah_no !== filters.surahNo) return false;
    if (filters.hasLinks !== null && filters.hasLinks !== undefined && !!v.has_links !== filters.hasLinks) return false;
    if (verseIdsWithType && !verseIdsWithType.has(verseId)) return false;
    return true;
  };

  const ids = new Set<number>();
  for (const v of verses) {
    if (v.norm.includes(normQuery) || v.normSurah.includes(normQuery)) ids.add(v.id);
  }
  for (const l of links) {
    if (
      l.normContent.includes(normQuery) ||
      l.normTitle.includes(normQuery) ||
      l.normTranscript.includes(normQuery)
    ) {
      ids.add(l.verse_id);
    }
  }
  if (ids.size === 0 && words.length >= 2) {
    for (const v of verses) {
      if (words.every((w) => v.norm.includes(w))) ids.add(v.id);
    }
    for (const l of links) {
      if (
        words.every(
          (w) => l.normContent.includes(w) || l.normTitle.includes(w) || l.normTranscript.includes(w),
        )
      ) {
        ids.add(l.verse_id);
      }
    }
  }
  return [...ids].filter(passesFilters).sort((a, b) => a - b);
}
