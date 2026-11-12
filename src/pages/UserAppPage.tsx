import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { loadVerseIndex, loadLinkIndex, searchVerseIds } from '../lib/searchIndex';
import { signOut } from '../lib/auth';
import type { QuranVerse, AyahLink } from '../lib/types';
import { LINK_TYPES, TOTAL_VERSES } from '../lib/types';
import { SURAHS } from '../lib/surahs';
import { useLang, speechLocale } from '../lib/LanguageContext';
import { readPendingProfile, retryPendingProfile } from '../lib/profileRepair';
import { dailyDua, ISLAMIC_GREETING } from '../lib/personalTouch';
import { getStoredLinkGender, resolveLinkAudio } from '../lib/linkAudio';
import { LANGUAGES } from '../lib/translations';
import { formatAr } from '../lib/numerals';
import {
  BookOpen, Search, ChevronRight, ChevronLeft, Home, LogOut, Globe,
  Heart, Bookmark, AlertTriangle, BadgeCheck, X, BookMarked, AlertCircle,
  Volume2, Filter, Layers, Mic,
} from 'lucide-react';
import BottomNav from '../components/BottomNav';
import DailyWird from '../components/DailyWird';
import ReviewDueCard from '../components/ReviewDueCard';
import ShareProgressCard from '../components/ShareProgressCard';
import { pressFeedback, installGlobalWater } from '../lib/pressFeedback';
import VoiceSelector from '../components/VoiceSelector';
import ShareButton from '../components/ShareButton';
import { useUserLists, ListToggleButtons, LongPressMenu, LinkLongPressMenu, type ListType } from '../components/UserLists';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'settings' | 'follow' | 'test' | 'listen' | 'adhkar' | 'room';
const PAGE_SIZE = 15;

export default function UserAppPage({ session, onNavigate }: { session: import('@supabase/supabase-js').Session | null; onNavigate: (r: Route) => void }) {
  const { t, lang, setLang } = useLang();
  const [verses, setVerses] = useState<QuranVerse[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState('');
  const [surahFilter, setSurahFilter] = useState('');
  // Multi-select (2026-11-04): selected link types; [] = all types.
  // Tapping a chip toggles membership; «كل الأنواع» clears to [].
  const [linkTypeFilter, setLinkTypeFilter] = useState<string[]>([]);
  // Link-type chip order (2026-11-04): most-approved first. The order
  // is computed from approved-link counts (link_types arrays on
  // approved rows only — no user content), cached in localStorage
  // for 24h so it does not refetch on every visit. «كل الأنواع»
  // always renders first, selection behavior is unchanged, and any
  // failure silently keeps the static LINK_TYPES order.
  const [orderedLinkTypes, setOrderedLinkTypes] = useState<{ value: string; label: string }[]>([...LINK_TYPES]);
  // Water ripple on every interactive element (global delegate in
  // pressFeedback.ts; idempotent install, also covers this page).
  useEffect(() => { installGlobalWater(); }, []);
  useEffect(() => {
    const CACHE_KEY = 'quran-link-type-order';
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { at?: number; values?: unknown };
        if (parsed && typeof parsed.at === 'number' && Array.isArray(parsed.values) && Date.now() - parsed.at < 24 * 3600 * 1000) {
          const byValue = new Map<string, { value: string; label: string }>();
          for (const t of LINK_TYPES) byValue.set(t.value, t);
          const restored: { value: string; label: string }[] = [];
          for (const v of parsed.values) {
            if (typeof v !== 'string') continue;
            const t = byValue.get(v);
            if (t && !restored.includes(t)) restored.push(t);
          }
          for (const t of LINK_TYPES) if (!restored.includes(t)) restored.push(t);
          if (restored.length === LINK_TYPES.length) {
            setOrderedLinkTypes(restored);
            return;
          }
        }
      }
    } catch { /* fall through to a fresh count */ }
    let cancelled = false;
    void (async () => {
      try {
        const counts = new Map<string, number>();
        const PAGE = 1000;
        for (let from = 0; from < 20000; from += PAGE) {
          const { data, error } = await supabase.from('ayah_links')
            .select('link_types').eq('status', 'approved').range(from, from + PAGE - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          for (const row of data) {
            const types = (row as { link_types?: string[] | null }).link_types;
            if (Array.isArray(types)) {
              for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
            }
          }
          if (data.length < PAGE) break;
        }
        if (cancelled) return;
        const ordered = [...LINK_TYPES].sort((a, b) => (counts.get(b.value) ?? 0) - (counts.get(a.value) ?? 0));
        setOrderedLinkTypes(ordered);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), values: ordered.map((t) => t.value) }));
        } catch { /* cache is best-effort only */ }
      } catch { /* silent fallback: the static order stays */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const [listFilter, setListFilter] = useState<ListType | ''>('');
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [verseLinks, setVerseLinks] = useState<Record<number, AyahLink[]>>({});
  const [showLinksFor, setShowLinksFor] = useState<number | null>(null);
  // Link audio voice (2026-10-28 policy): the user's registered
  // gender decides — male users always hear the generated male
  // voice, female users hear the original or the generated female
  // voice. There is no manual voice switch anymore; gender is set
  // in Settings. Unknown gender → female side (historical default).
  const [profileGender, setProfileGender] = useState<'male' | 'female' | null>(null);
  const [preferredName, setPreferredName] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState('');
  // S1 auth stream: non-blocking profile-repair state. When signup's
  // profile insert failed, a pending payload is stored (see
  // lib/profileRepair); the App shell already retried it on sign-in,
  // and this banner covers the case where that retry ALSO failed:
  // the user is told, can retry with one tap, and nothing here blocks
  // the rest of لوحتي. Dismissing only hides it for this visit — the
  // payload stays for the next sign-in retry.
  const [profileRepairNeeded, setProfileRepairNeeded] = useState(false);
  const [profileRepairBusy, setProfileRepairBusy] = useState(false);
  const [profileRepairError, setProfileRepairError] = useState('');

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    const pending = readPendingProfile();
    if (!pending || pending.user_id !== userId) return;
    let cancelled = false;
    void retryPendingProfile(supabase, userId).then((res) => {
      if (!cancelled && !res.ok) setProfileRepairNeeded(true);
    }).catch(() => {
      if (!cancelled) setProfileRepairNeeded(true);
    });
    return () => { cancelled = true; };
  }, [session]);
  const linkGender = getStoredLinkGender(profileGender);
  const [longPressVerse, setLongPressVerse] = useState<QuranVerse | null>(null);
  const [longPressLink, setLongPressLink] = useState<{ verse: QuranVerse; link: AyahLink } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linkLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchHint, setSearchHint] = useState('');
  // Voice search: browser SpeechRecognition, locale follows the chosen UI
  // language (ar-EG for Egyptian dialect, ar-SA otherwise), same pattern as
  // LinkModal. The transcript is written into `search`, so the same
  // search path and diacritic-clean match (ayah_text_clean) apply to
  // voice exactly as they do to typed text — no separate search path.
  // Search works from a single word up (no minimum word count), and
  // when a search term is present the whole Mushaf is searched, not
  // just the ayahs that already have links.
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const voiceFinalRef = useRef('');
  const voiceInterimRef = useRef('');

  // Load the user's registered gender once: it sets the default link voice.
  // Also loads the name they like to be called by (preferred_name first).
  useEffect(() => {
    const loadGender = async () => {
      const userId = session?.user?.id;
      if (!userId) return;
      const { data, error } = await supabase.from('user_profiles').select('username, preferred_name, gender').eq('user_id', userId).single();
      const profile = error ? (await supabase.from('user_profiles').select('username, gender').eq('user_id', userId).single()).data : data;
      if (profile?.gender === 'male' || profile?.gender === 'female') setProfileGender(profile.gender);
      if ((profile as { preferred_name?: string | null } | null)?.preferred_name) setPreferredName((profile as unknown as { preferred_name: string }).preferred_name);
    };
    loadGender();
  }, [session]);

  const { lists, linkLists, toggleList: toggleListRaw, toggleLinkList } = useUserLists();

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const trimmed = search.trim();
    const isNumber = /^\d+$/.test(trimmed);
    const isColonFormat = /^\d+\s*[:：]\s*\d+$/.test(trimmed);

    if (isNumber || isColonFormat || trimmed === '') {
      setDebouncedSearch(trimmed);
      setSearchHint('');
      return;
    }

    debounceTimer.current = setTimeout(() => {
      const cleanText = trimmed.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u08D3-\u08FF\u0640\u200C-\u200F\u061C\u061F]/g, '').replace(/ـ/g, '').trim();
      const words = cleanText.split(/\s+/).filter((w) => w.length > 0);
      // Any real word searches (the old 3-word minimum blocked 1-2 word
      // searches and short voice phrases outright, which read as
      // "search doesn't work"). Input that cleans to nothing (marks
      // only) simply does not search.
      if (words.length >= 1) {
        setSearchHint('');
        setDebouncedSearch(trimmed);
      } else {
        setSearchHint('');
        setDebouncedSearch('');
      }
    }, 500);

    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [search]);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = speechLocale(lang);
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        // isFinal lives on the RESULT, not its first alternative
        // (same bug as follow/self-test: finals were never counted).
        const res = e.results[i];
        const r = res[0];
        if (res.isFinal || r.isFinal) voiceFinalRef.current += r.transcript + ' ';
        else interim += r.transcript + ' ';
      }
      voiceInterimRef.current = interim;
      const display = (voiceFinalRef.current + ' ' + interim).trim();
      if (display) { setSearch(display); setPage(0); }
    };
    rec.onerror = (e: any) => {
      setIsListening(false);
      setSearchHint(
        e.error === 'not-allowed' ? 'اسمح بالميكروفون من إعدادات المتصفح ثم حاول مجدداً'
        : e.error === 'no-speech' ? 'لم أسمع شيئاً — اضغط الميكروفون وحاول مجدداً'
        : e.error === 'network' ? 'البحث الصوتي يحتاج اتصالاً بالإنترنت'
        : 'تعذر البحث الصوتي — حاول مجدداً'
      );
    };
    rec.onend = () => {
      setIsListening(false);
      const finalText = voiceFinalRef.current.trim() || voiceInterimRef.current.trim();
      if (finalText) { setSearch(finalText); setPage(0); }
    };
    recognitionRef.current = rec;
    return () => { try { rec.stop(); } catch {} };
  }, []);

  const toggleVoiceSearch = () => {
    if (isListening) { try { recognitionRef.current?.stop(); } catch {} return; }
    if (!recognitionRef.current) {
      setSearchHint('هذا المتصفح لا يدعم البحث الصوتي — اكتب البحث بدلاً منه');
      return;
    }
    voiceFinalRef.current = '';
    voiceInterimRef.current = '';
    setSearchHint('جارٍ الاستماع…');
    setIsListening(true);
    try { recognitionRef.current.start(); } catch { setIsListening(false); }
  };

  const toggleList = async (verseId: number, listType: ListType, linkId?: number) => {
    await toggleListRaw(verseId, listType, linkId);
  };

  // Link-menu toggles go through the true per-link toggle (tapping a
  // labeled link again removes its label); verse menus keep the
  // verse-level toggle, and memorized stays verse-level.
  const toggleLink = async (verseId: number, listType: ListType, linkId?: number) => {
    if (linkId && (listType === 'read_later' || listType === 'difficult')) {
      await toggleLinkList(verseId, linkId, listType);
    } else {
      await toggleListRaw(verseId, listType, linkId);
    }
  };

  // Link-audio replay: tapping a link's listen button again restarts
  // the same clip instead of layering a second Audio instance over it.
  const linkAudioRef = useRef<HTMLAudioElement | null>(null);
  const playLinkAudio = (url: string) => {
    try { linkAudioRef.current?.pause(); } catch {}
    const audio = new Audio(url);
    linkAudioRef.current = audio;
    void audio.play().catch(() => {});
  };

  const fetchVerses = useCallback(async () => {
    setLoading(true);

    if (listFilter) {
      const { data: { session: sess } } = await supabase.auth.getSession();
      if (!sess) { setLoading(false); return; }

      let listQuery = supabase
        .from('user_lists')
        .select('verse_id')
        .eq('user_id', sess.user.id)
        .eq('list_type', listFilter);

      const { data: listData } = await listQuery;
      const verseIds = (listData || []).map((d) => d.verse_id);

      if (verseIds.length === 0) {
        setVerses([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }

      if (debouncedSearch) {
        try {
          const verses = await loadVerseIndex();
          const ids = searchVerseIds(verses, [], debouncedSearch, {
            verseIds,
            surahNo: surahFilter ? parseInt(surahFilter) : null,
          });
          const pageIds = ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
          const { data: pageData } = await supabase.from('quran_verses').select('*').in('id', pageIds).order('id', { ascending: true });
          setVerses(pageData || []);
          setTotalCount(ids.length);
        } catch {
          setSearchHint('تعذر تحميل فهرس البحث — حاول مجدداً');
          setVerses([]);
          setTotalCount(0);
        }
        setLoading(false);
        return;
      }
      let query = supabase.from('quran_verses').select('*', { count: 'exact' }).in('id', verseIds);
      if (surahFilter) query = query.eq('surah_no', parseInt(surahFilter));
      query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1).order('id', { ascending: true });
      const { data, count } = await query;
      setVerses(data || []);
      setTotalCount(count || 0);
    } else {
      // Link-type filter narrows every path below (browse and search).
      let linkVerseIds: number[] | null = null;
      if (linkTypeFilter.length > 0) {
        const { data: linkData } = await supabase
          .from('ayah_links')
          .select('verse_id')
          .overlaps('link_types', linkTypeFilter)
          .eq('status', 'approved');
        linkVerseIds = (linkData || []).map((d) => d.verse_id);
        if (linkVerseIds.length === 0) {
          setVerses([]);
          setTotalCount(0);
          setLoading(false);
          return;
        }
      }

      if (debouncedSearch) {
        // Cross-rasm search (Uthmani / imla'i / voice transcripts):
        // the whole Mushaf + approved links are searched in memory
        // on normalized text (see lib/searchIndex + lib/arabicNormalize),
        // so spelling variants of the same word all match. The surah
        // and link-type filters apply to both sources, as before.
        try {
          const [verses, links] = await Promise.all([loadVerseIndex(), loadLinkIndex()]);
          // Multi-select (2026-11-04): searchVerseIds takes only a
          // single linkType, so the ANY-match filter over the selected
          // types is applied here by intersecting with the verses
          // that carry any selected type — the same verse set the old
          // single-type filter produced.
          const verseIdsWithSelectedTypes: Set<number> | null = linkTypeFilter.length > 0
            ? new Set(links.filter((l) => l.link_types.some((t) => linkTypeFilter.includes(t))).map((l) => l.verse_id))
            : null;
          const ids = searchVerseIds(verses, links, debouncedSearch, {
            surahNo: surahFilter ? parseInt(surahFilter) : null,
            linkType: null,
          });
          const filteredIds = verseIdsWithSelectedTypes
            ? ids.filter((id) => verseIdsWithSelectedTypes.has(id))
            : ids;
          if (filteredIds.length === 0) { setVerses([]); setTotalCount(0); setLoading(false); return; }
          const pageIds = filteredIds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
          const { data: pageData } = await supabase.from('quran_verses').select('*').in('id', pageIds).order('id', { ascending: true });
          setVerses(pageData || []);
          setTotalCount(filteredIds.length);
        } catch {
          setSearchHint('تعذر تحميل فهرس البحث — حاول مجدداً');
          setVerses([]);
          setTotalCount(0);
        }
        setLoading(false);
        return;
      }

      // No search term: browse ayahs that have links, paginated.
      let query = supabase.from('quran_verses').select('*', { count: 'exact' }).eq('has_links', true);
      if (surahFilter) query = query.eq('surah_no', parseInt(surahFilter));
      if (linkVerseIds) query = query.in('id', linkVerseIds);
      query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1).order('id', { ascending: true });
      const { data, count } = await query;
      setVerses(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  }, [debouncedSearch, surahFilter, linkTypeFilter, listFilter, page]);

  useEffect(() => {
    fetchVerses();
  }, [fetchVerses]);

  const fetchVerseLinks = async (verseId: number) => {
    const { data } = await supabase.from('ayah_links').select('*').eq('verse_id', verseId).eq('status', 'approved');
    setVerseLinks((prev) => ({ ...prev, [verseId]: data || [] }));
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const handleLongPressStart = (verse: QuranVerse) => {
    longPressTimer.current = setTimeout(() => setLongPressVerse(verse), 500);
  };
  const handleLongPressClear = () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); };
  const handleLinkLongPressStart = (verse: QuranVerse, link: AyahLink) => {
    linkLongPressTimer.current = setTimeout(() => setLongPressLink({ verse, link }), 500);
  };
  const handleLinkLongPressClear = () => { if (linkLongPressTimer.current) clearTimeout(linkLongPressTimer.current); };

  const savePreferredName = async () => {
    const userId = session?.user?.id;
    if (!userId) return;
    const value = nameDraft.trim() || null;
    // Upsert, not update: a user whose signup-time profile insert failed
    // (no session before email confirmation, so RLS denied it) has no
    // row, and a plain update would silently affect zero rows.
    const { error } = await supabase.from('user_profiles').upsert({ user_id: userId, preferred_name: value }, { onConflict: 'user_id' });
    if (error) { setNameError('تعذر حفظ الاسم، حاول تاني'); return; }
    setPreferredName(value);
    setNameError('');
    setEditingName(false);
  };

  const listCounts = {
    read_later: lists.read_later.size,
    difficult: lists.difficult.size,
    memorized: lists.memorized.size,
  };

  // مركز الحفظ gate (Amr 2026-10-30): people memorize from ANY point,
  // so a global "X of 6236" % is only meaningful for a run that starts
  // at the very beginning of the Mushaf. quran_verses ids run 1..6236
  // in Mushaf order (verified against the seeded table), so the
  // from-start run is the count of consecutive memorized ids starting
  // at 1. The card below shows ONLY this run, and hides when it is 0.
  let memorizedFromStart = 0;
  while (lists.memorized.has(memorizedFromStart + 1)) memorizedFromStart++;

  const activeFiltersCount = (surahFilter ? 1 : 0) + (linkTypeFilter.length > 0 ? 1 : 0) + (debouncedSearch ? 1 : 0);

  return (
    <div className="min-h-screen page-bg pb-24 route-in">
      {/* Header */}
      <header className="sticky top-0 z-40 app-header">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
              <BookOpen className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-ink">{t('appName')}</h1>
              <p className="text-sm text-ink-2">{preferredName ? `لوحة ${preferredName} — روابط الآيات` : 'لوحتي — روابط الآيات'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <button onClick={() => setShowLangMenu(!showLangMenu)}
                className="flex items-center gap-1.5 px-2.5 py-2.5 text-sm text-ink-2 hover:bg-gray-100 rounded-lg transition-smooth polish-press">
                <Globe className="w-5 h-5" />
                {LANGUAGES.find((l) => l.code === lang)?.flag}
              </button>
              {showLangMenu && (
                <div className="absolute left-0 mt-2 bg-white rounded-xl shadow-xl border border-hairline p-2 min-w-[150px] z-50 animate-slide-up">
                  {LANGUAGES.map((l) => (
                    <button key={l.code}
                      onClick={() => { setLang(l.code); setShowLangMenu(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-smooth ${
                        lang === l.code ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'hover:bg-gray-50 text-ink-2'
                      }`}>
                      <span>{l.flag}</span>{l.nativeName}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {session && (
              <button onClick={async () => { await signOut(); onNavigate('home'); }}
                className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-smooth font-semibold polish-press">
                <LogOut className="w-5 h-5" /> خروج
              </button>
            )}
            <button onClick={() => onNavigate('mushaf')}
              className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-emerald-700 hover:bg-emerald-50 rounded-xl transition-smooth font-semibold border border-hairline-emerald polish-press">
              <BookMarked className="w-5 h-5" /> المصحف
            </button>
            <button onClick={() => onNavigate('home')}
              className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-ink-2 hover:bg-gray-100 rounded-lg transition-smooth polish-press">
              <Home className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {profileRepairNeeded && (
          <div className="mb-5 bg-amber-50 border border-hairline-amber rounded-2xl p-4 shadow-sm">
            <p className="text-sm text-amber-800 leading-relaxed">
              بيانات ملفك (اسم المستخدم والنوع) لم تُحفظ بعد — اضغط لإعادة المحاولة، ولو استمرت المشكلة ستظل لوحتك شغالة عادي.
            </p>
            {profileRepairError && <p className="text-xs text-red-600 mt-2">{profileRepairError}</p>}
            <div className="flex gap-2 mt-3">
              <button
                disabled={profileRepairBusy}
                onClick={async () => {
                  const userId = session?.user?.id;
                  if (!userId) return;
                  setProfileRepairBusy(true);
                  setProfileRepairError('');
                  const res = await retryPendingProfile(supabase, userId).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : 'unknown error' }));
                  setProfileRepairBusy(false);
                  if (res.ok) {
                    setProfileRepairNeeded(false);
                  } else {
                    setProfileRepairError(res.error || 'تعذرت إعادة المحاولة — حاول مرة أخرى.');
                  }
                }}
                className="px-3 py-2 grad-amber-door text-white text-sm font-bold rounded-xl disabled:opacity-50 polish-press">
                {profileRepairBusy ? '...' : 'إعادة المحاولة'}
              </button>
              <button onClick={() => setProfileRepairNeeded(false)}
                className="px-3 py-2 text-sm text-amber-link hover:text-amber-900">
                إخفاء
              </button>
            </div>
          </div>
        )}
        {/* Personal greeting — just the salam (the board name is
            already clear in the header above, so it is not repeated
            here), a one-line reminder, and a personal dua */}
        <div className="mb-5 grad-emerald-door rounded-2xl p-5 shadow-lg text-white">
          <div className="flex items-center gap-2">
            <Heart className="w-5 h-5 flex-shrink-0 text-white" fill="currentColor" />
            <p className="text-lg font-semibold leading-relaxed">
              {preferredName ? `${ISLAMIC_GREETING}، يا ${preferredName}` : ISLAMIC_GREETING}
            </p>
            {session && !editingName && (
              <button onClick={() => { setNameDraft(preferredName || ''); setNameError(''); setEditingName(true); }}
                className="mr-auto text-xs text-emerald-100 underline underline-offset-2 hover:text-white flex-shrink-0">
                تعديل الكنية
              </button>
            )}
          </div>
          {session && editingName && (
            <div className="flex gap-2 mt-3">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                placeholder="اكتب كنيتك (مثال: أبو …)"
                className="flex-1 px-3 py-2 rounded-xl text-sm text-ink bg-white/95 border border-hairline-input focus:outline-none" />
              <button onClick={savePreferredName} className="px-3 py-2 bg-white text-emerald-700 text-sm font-bold rounded-xl polish-press">حفظ</button>
              <button onClick={() => setEditingName(false)} className="px-3 py-2 text-sm text-emerald-100">إلغاء</button>
            </div>
          )}
          {nameError && <p className="text-xs text-red-200 mt-2">{nameError}</p>}
          <p className="text-sm text-emerald-50 leading-relaxed mt-2">
            {(listCounts.read_later + listCounts.difficult + listCounts.memorized) > 0
              ? `ما شاء الله، بارك الله فيك — جمعت ${(listCounts.read_later + listCounts.difficult + listCounts.memorized).toLocaleString('ar-EG')} آية في قوائمك${listCounts.memorized > 0 ? `، وحفظت ${listCounts.memorized.toLocaleString('ar-EG')} آية` : ''}، تقبل الله منك وثبّتها في قلبك`
              : 'استحضر النية'}
          </p>
          <p className="text-sm text-emerald-100 font-semibold leading-relaxed mt-3 pt-3 border-t border-white/20">
            {dailyDua()}
          </p>
        </div>

        {/* مركز الحفظ — GATED (Amr 2026-10-30): people memorize from any
            point, so a global "X of 6236" % is meaningless for scattered
            memorization. The card shows ONLY the contiguous run that
            starts at the very beginning of the Mushaf (verse ids run
            1..6236 in Mushaf order), and hides entirely when that run
            is 0. The full memorized list stays reachable via the
            "عرض الآيات المحفوظة" button below (the "تم الحفظ" tab was
            removed 2026-11-04; the filter is set programmatically). */}
        {session && memorizedFromStart > 0 && (
          <div className="mb-5 glass-card rounded-2xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-1">
              <BadgeCheck className="w-5 h-5 text-emerald-700" />
              <h2 className="font-semibold text-ink">مركز الحفظ</h2>
            </div>
            <p className="text-2xl font-bold text-ink">
              حفظت {formatAr(memorizedFromStart)} آية من أول المصحف من {formatAr(TOTAL_VERSES)} — {formatAr(Math.round((memorizedFromStart / TOTAL_VERSES) * 100))}٪
            </p>
            <p className="text-sm text-ink-2 leading-relaxed mt-1">
              تقدّمك من أول المصحف — وآياتك المحفوظة كلها تحت، ومع كل آية روابطها.
            </p>
            <button onClick={() => { setListFilter('memorized'); setPage(0); }}
              className="mt-3 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
              عرض الآيات المحفوظة
            </button>
          </div>
        )}

        {/* Shareable progress card (2026-11-06, feature #6): the same
            real from-start run as the gate card above — rendered as a
            shareable image (canvas) or share text. Same gate: hidden
            while the run is 0. */}
        {session && memorizedFromStart > 0 && (
          <ShareProgressCard memorizedFromStart={memorizedFromStart} />
        )}

        {/* المراجعة المستحقة (2026-11-07): moved here from Home. */}
        <ReviewDueCard
          run={memorizedFromStart}
          onNavigate={onNavigate}
          onJumpToAyah={(surah, ayah) => {
            try { localStorage.setItem('quran-mushaf-target', JSON.stringify({ surah, ayah })); } catch { /* ignore */ }
            onNavigate('mushaf');
          }}
        />

        {/* Daily wird + self-test entry */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          <DailyWird onNavigate={onNavigate} />
          <div className="glass-card rounded-2xl shadow-sm p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <Mic className="w-5 h-5 text-emerald-700" />
              <h2 className="font-semibold text-ink">سمّع لي</h2>
            </div>
            <button onClick={() => onNavigate('test')}
              className="mt-4 md:mt-auto w-full py-2.5 grad-emerald-door text-white font-bold rounded-xl polish-press polish-focus">
              ابدأ التسميع
            </button>
          </div>
        </div>

        {/* List filter tabs */}
        {session && (
          <div className="flex gap-2 mb-4 flex-wrap">
            <ListFilterTab active={listFilter === ''} onClick={() => { setListFilter(''); setPage(0); }}
              label={t('allStatus')} icon={<BookOpen className="w-5 h-5" />} />
            <ListFilterTab active={listFilter === 'read_later'} onClick={() => { setListFilter('read_later'); setPage(0); }}
              label={t('readLater')} icon={<Bookmark className="w-5 h-5" />} count={listCounts.read_later} />
            <ListFilterTab active={listFilter === 'difficult'} onClick={() => { setListFilter('difficult'); setPage(0); }}
              label={t('difficult')} icon={<AlertTriangle className="w-5 h-5" />} count={listCounts.difficult} />
          </div>
        )}

        {/* Filter toggle bar */}
        <div className="glass-card rounded-2xl shadow-sm mb-4 overflow-hidden">
          <button onClick={() => setShowFilters(!showFilters)}
            onPointerDown={pressFeedback}
            className="w-full flex items-center justify-between p-4 text-right">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-emerald-700" />
              <span className="text-base font-semibold text-ink">أدوات الفلترة</span>
              {activeFiltersCount > 0 && (
                <span className="flex items-center justify-center w-6 h-6 bg-emerald-700 text-white text-xs font-bold rounded-full">
                  {activeFiltersCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {(search || surahFilter || linkTypeFilter.length > 0) && (
                <button onClick={(e) => { e.stopPropagation(); setSearch(''); setSurahFilter(''); setLinkTypeFilter([]); setPage(0); }}
                  className="text-sm text-red-500 hover:text-red-600 font-semibold">
                  مسح الكل
                </button>
              )}
              <ChevronLeft className={`w-5 h-5 text-ink-2 transition-transform ${showFilters ? '-rotate-90' : ''}`} />
            </div>
          </button>

          {showFilters && (
            <div className="px-4 pb-4 space-y-3 animate-slide-up border-t border-gray-50 pt-4">
              {/* Search */}
              <div>
                <label className="block text-sm font-semibold text-ink-2 mb-1.5">بحث في الآيات والروابط</label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-700" />
                  <input type="text" value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                    placeholder={t('search')}
                    className="w-full pr-11 pl-12 py-3 bg-gray-50 border border-hairline rounded-xl text-base focus:outline-none focus:border-emerald-500 transition-smooth" />
                  <button type="button" onClick={toggleVoiceSearch}
                    onPointerDown={pressFeedback}
                    title={isListening ? 'إيقاف الاستماع' : 'بحث صوتي'}
                    className={`absolute left-2 top-1/2 -translate-y-1/2 p-2.5 rounded-full transition-smooth shadow-sm ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
                    <Mic className="w-5 h-5" />
                  </button>
                </div>
                {searchHint && (
                  <div className="flex items-center gap-1.5 text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg border border-hairline-emerald mt-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {searchHint}
                  </div>
                )}
              </div>

              {/* Surah selection */}
              <div>
                <label className="block text-sm font-semibold text-ink-2 mb-1.5">اختر السورة</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-[200px] overflow-y-auto p-1">
                  <button onClick={() => { setSurahFilter(''); setPage(0); }}
                    className={`p-2.5 rounded-lg text-sm font-semibold transition-smooth border ${
                      surahFilter === '' ? 'grad-emerald-door text-white border-emerald-700 polish-press' : 'bg-white text-ink-2 border-hairline hover:border-hairline-emerald polish-press'
                    }`}>
                    كل السور
                  </button>
                  {SURAHS.map((s) => (
                    <button key={s.no} onClick={() => { setSurahFilter(String(s.no)); setPage(0); }}
                      className={`flex items-center gap-1.5 p-2.5 rounded-lg text-sm font-semibold transition-smooth border ${
                        surahFilter === String(s.no) ? 'grad-emerald-door text-white border-emerald-700 polish-press' : 'bg-white text-ink-2 border-hairline hover:border-hairline-emerald polish-press'
                      }`}>
                      <span className="text-xs opacity-60">{s.no}.</span>
                      <span>{s.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Link type filter */}
              <div>
                <label className="block text-sm font-semibold text-ink-2 mb-1.5 flex items-center gap-1.5">
                  <Layers className="w-5 h-5 text-emerald-700" /> نوع الرابط
                </label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => { setLinkTypeFilter([]); setPage(0); }}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold transition-smooth border ${
                      linkTypeFilter.length === 0 ? 'grad-emerald-door text-white border-emerald-700 polish-press' : 'bg-white text-ink-2 border-hairline hover:border-hairline-emerald polish-press'
                    }`}>
                    كل الأنواع
                  </button>
                  {/* وجه hidden per user order 2026-11-04: the type stays in lib/types and its links remain under كل الأنواع. */}
                  {orderedLinkTypes.filter((lt) => lt.value !== 'wajih').map((lt) => (
                    <button key={lt.value} onClick={() => { setLinkTypeFilter((prev) => (prev.includes(lt.value) ? prev.filter((v) => v !== lt.value) : [...prev, lt.value])); setPage(0); }}
                      className={`px-3 py-2 rounded-lg text-sm font-semibold transition-smooth border ${
                        linkTypeFilter.includes(lt.value) ? 'grad-emerald-door text-white border-emerald-700 polish-press' : 'bg-white text-ink-2 border-hairline hover:border-hairline-emerald polish-press'
                      }`}>
                      {lt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Results count */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-ink-2">
            {loading ? 'جارٍ التحميل...' : `${totalCount} آية`}
          </p>
        </div>

        {/* Verses list */}
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <div className="w-12 h-12 border-4 border-hairline-emerald border-t-emerald-600 rounded-full animate-spin" />
          </div>
        ) : verses.length === 0 ? (
          <div className="glass-card rounded-2xl py-20 text-center shadow-sm">
            <BookOpen className="w-14 h-14 text-ink-3 mx-auto mb-3" />
            <p className="text-base text-ink-3">{listFilter ? 'لا توجد آيات في هذه القائمة' : t('noLinksYet')}</p>
          </div>
        ) : !debouncedSearch && !surahFilter ? (
          // Surah headers only (2026-10-28): no ayahs are laid out under
          // the surah names until the user asks for a specific surah
          // (tap a header — it sets the same surah filter the filter
          // chips use) or a specific ayah (search). Grouped from the
          // current page's verses, in order; no counts are shown because
          // a page holds only part of a surah's ayahs.
          <div className="space-y-3">
            {(() => {
              const groups: { no: number; name: string }[] = [];
              for (const v of verses) {
                if (!groups.some((g) => g.no === v.surah_no)) groups.push({ no: v.surah_no, name: v.surah_name });
              }
              return groups.map((g) => (
                <button key={g.no} onClick={() => { setSurahFilter(String(g.no)); setPage(0); }}
                  className="w-full flex items-center justify-between bg-white rounded-2xl border border-hairline-emerald shadow-sm p-4 hover:shadow-md transition-smooth polish-press">
                  <span className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-8 h-8 bg-emerald-100 text-emerald-700 text-sm font-bold rounded-lg">{g.no.toLocaleString('ar-EG')}</span>
                    <span className="text-base font-semibold text-ink">سورة {g.name}</span>
                  </span>
                  <span className="flex items-center gap-1 text-sm font-semibold text-emerald-700">عرض الآيات <ChevronLeft className="w-5 h-5" /></span>
                </button>
              ));
            })()}
          </div>
        ) : (
          <div className="space-y-4">
            {verses.map((verse) => {
              const links = verseLinks[verse.id] || [];
              return (
                <div
                  key={verse.id}
                  onTouchStart={() => handleLongPressStart(verse)}
                  onTouchEnd={handleLongPressClear}
                  onTouchMove={handleLongPressClear}
                  className="bg-white rounded-2xl border border-hairline-emerald overflow-hidden shadow-sm hover:shadow-md transition-smooth animate-fade-in"
                >
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="flex items-center justify-center w-8 h-8 bg-emerald-100 text-emerald-700 text-sm font-bold rounded-lg">
                            {verse.surah_no}:{verse.ayah_no}
                          </span>
                          <span className="text-base font-semibold text-ink-2">{verse.surah_name}</span>
                        </div>
                        <p className="font-arabic text-2xl text-ink leading-loose">
                          {verse.ayah_text}
                        </p>
                      </div>
                      {session && (
                        <ListToggleButtons verse={verse} lists={lists} onToggle={toggleList} />
                      )}
                    </div>

                    {/* Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-4 border-t border-gray-50">
                      <div className="flex items-center gap-2">
                        <VoiceSelector text={verse.ayah_text} />
                        <button
                          onClick={() => {
                            if (showLinksFor === verse.id) {
                              setShowLinksFor(null);
                            } else {
                              setShowLinksFor(verse.id);
                              if (!verseLinks[verse.id]) fetchVerseLinks(verse.id);
                            }
                          }}
                          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-smooth ${
                            showLinksFor === verse.id ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-50 text-ink-2 hover:bg-gray-100 polish-press'
                          }`}
                        >
                          <Bookmark className="w-5 h-5" />
                          {verse.links_count} {t('linksCount')}
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            try {
                              localStorage.setItem('quran-mushaf-target', JSON.stringify({ surah: verse.surah_no, ayah: verse.ayah_no }));
                            } catch { /* storage unavailable: still navigate to the Mushaf */ }
                            onNavigate('mushaf');
                          }}
                          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-smooth bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-hairline-emerald polish-press"
                        >
                          <BookMarked className="w-5 h-5" />
                          فتح في المصحف
                        </button>
                        <ShareButton verseText={verse.ayah_text} surahName={verse.surah_name} ayahNo={verse.ayah_no} surahNo={verse.surah_no} />
                      </div>
                    </div>

                    {/* Links display */}
                    {showLinksFor === verse.id && links.length > 0 && (
                      <div className="mt-4 space-y-2 animate-slide-up">
                        {links.map((link) => (
                          <div
                            key={link.id}
                            onTouchStart={() => handleLinkLongPressStart(verse, link)}
                            onTouchEnd={handleLinkLongPressClear}
                            onTouchMove={handleLinkLongPressClear}
                            className="flex items-start gap-2 text-sm bg-gray-50 hover:bg-emerald-50 rounded-lg p-3 transition-smooth cursor-pointer select-none"
                          >
                            <span className={`px-2 py-1 rounded-full font-semibold whitespace-nowrap text-xs ${
                              getLinkTypeColor(link.link_types?.[0] || '')
                            }`}>
                              {(link.link_types || []).map((lt: string) => LINK_TYPES.find((t) => t.value === lt)?.label || lt).join('، ')}
                            </span>
                            <div className="flex-1 min-w-0">
                              {link.link_title && (
                                <p className="font-semibold text-ink-2 mb-1 text-base">{link.link_title}</p>
                              )}
                              <p className="text-ink-2 leading-relaxed text-base">{link.link_content}</p>
                              {(() => {
                                const audio = resolveLinkAudio(link, linkGender);
                                return (
                                  <div className="flex flex-wrap items-center gap-2 mt-2">
                                    {audio && (
                                      <button onClick={() => playLinkAudio(audio.url)}
                                        className="flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline">
                                        <Volume2 className="w-4 h-4" /> استماع للتربيطة ({audio.label})
                                      </button>
                                    )}
                                    <button
                                      onClick={() => toggleLinkList(verse.id, link.id, 'read_later')}
                                      onTouchStart={(e) => e.stopPropagation()}
                                      onTouchEnd={(e) => e.stopPropagation()}
                                      aria-label={t('readLater')}
                                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition-smooth ${
                                        linkLists.read_later.has(`${verse.id}:${link.id}`) ? 'grad-emerald-door text-white' : 'bg-white text-ink-2 border border-hairline hover:border-hairline-emerald polish-press'
                                      }`}>
                                      <Bookmark className="w-4 h-4" /> {t('readLater')}
                                    </button>
                                    <button
                                      onClick={() => toggleLinkList(verse.id, link.id, 'difficult')}
                                      onTouchStart={(e) => e.stopPropagation()}
                                      onTouchEnd={(e) => e.stopPropagation()}
                                      aria-label={t('difficult')}
                                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition-smooth ${
                                        linkLists.difficult.has(`${verse.id}:${link.id}`) ? 'grad-emerald-door text-white' : 'bg-white text-ink-2 border border-hairline hover:border-hairline-emerald polish-press'
                                      }`}>
                                      <AlertTriangle className="w-4 h-4" /> {t('difficult')}
                                    </button>
                                  </div>
                                );
                              })()}
                            </div>
                            <span className="text-xs text-ink-3 hidden sm:inline">اضغط مطولاً للقائمة</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 bg-white rounded-xl border border-hairline p-3 shadow-sm">
            <p className="text-sm text-ink-2">
              {page + 1} / {totalPages}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                className="p-2 text-ink-2 hover:bg-gray-100 rounded-lg disabled:opacity-30 transition-smooth polish-press">
                <ChevronRight className="w-5 h-5" />
              </button>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                className="p-2 text-ink-2 hover:bg-gray-100 rounded-lg disabled:opacity-30 transition-smooth polish-press">
                <ChevronLeft className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Bottom nav: الرئيسية first (rightmost in RTL). */}
      <BottomNav current="app" onNavigate={onNavigate} />

      {/* Long press menus */}
      {longPressVerse && session && (
        <LongPressMenu
          verse={longPressVerse}
          onAddToList={toggleList}
          onClose={() => setLongPressVerse(null)}
        />
      )}
      {longPressLink && session && (
        <LinkLongPressMenu
          verse={longPressLink.verse}
          link={longPressLink.link}
          onAddToList={toggleLink}
          onClose={() => setLongPressLink(null)}
        />
      )}
    </div>
  );
}

function ListFilterTab({ active, onClick, label, icon, count }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode; count?: number }) {
  // Icon system: one size (w-5, set at the call site) and one rule —
  // active icons are white on emerald, inactive icons are solid
  // emerald-700 on white (never faint gray outlines, which read as
  // "empty" next to the filled active tab).
  return (
    <button
      onPointerDown={pressFeedback}
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl transition-smooth ${
        active
          ? 'grad-emerald-door text-white [&>svg]:text-white polish-press'
          : 'bg-white text-ink-2 hover:bg-gray-50 border border-hairline [&>svg]:text-emerald-700 polish-press'
      }`}
    >
      {icon}
      {label}
      {count !== undefined && count > 0 && (
        <span className={`text-xs px-2 rounded-full ${active ? 'bg-white/30' : 'bg-emerald-100 text-emerald-700'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function getLinkTypeColor(type: string): string {
  const colors: Record<string, string> = {
    wajih: 'bg-blue-100 text-blue-700',
    sifa: 'bg-cyan-100 text-cyan-700',
    mutashabihat: 'bg-teal-100 text-teal-700',
    sabab_nuzul: 'bg-orange-100 text-orange-700',
    fawaaid: 'bg-emerald-100 text-emerald-700',
    lafdhi: 'bg-pink-100 text-pink-700',
    adadi: 'bg-amber-100 text-amber-link',
    maqam: 'bg-indigo-100 text-indigo-700',
    takrir: 'bg-rose-100 text-rose-700',
  };
  return colors[type] || 'bg-gray-100 text-ink-2';
}
