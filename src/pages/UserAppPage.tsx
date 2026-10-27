import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { loadVerseIndex, loadLinkIndex, searchVerseIds } from '../lib/searchIndex';
import { signOut } from '../lib/auth';
import type { QuranVerse, AyahLink } from '../lib/types';
import { LINK_TYPES } from '../lib/types';
import { SURAHS } from '../lib/surahs';
import { useLang, speechLocale } from '../lib/LanguageContext';
import { dailyDua, ISLAMIC_GREETING } from '../lib/personalTouch';
import { LANGUAGES } from '../lib/translations';
import {
  BookOpen, Search, ChevronRight, ChevronLeft, Home, LogOut, Globe,
  Heart, Bookmark, AlertTriangle, BadgeCheck, X, BookMarked, AlertCircle,
  Volume2, Filter, Layers, Mic,
} from 'lucide-react';
import BottomNav from '../components/BottomNav';
import DailyWird from '../components/DailyWird';
import VoiceSelector from '../components/VoiceSelector';
import ShareButton from '../components/ShareButton';
import QRCodeSection from '../components/QRCodeSection';
import { useUserLists, ListToggleButtons, LongPressMenu, LinkLongPressMenu, type ListType } from '../components/UserLists';
import ProgressWidget from '../components/ProgressWidget';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'follow' | 'test';
const PAGE_SIZE = 15;

export default function UserAppPage({ session, onNavigate }: { session: import('@supabase/supabase-js').Session | null; onNavigate: (r: Route) => void }) {
  const { t, lang, setLang } = useLang();
  const [verses, setVerses] = useState<QuranVerse[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState('');
  const [surahFilter, setSurahFilter] = useState('');
  const [linkTypeFilter, setLinkTypeFilter] = useState('');
  const [listFilter, setListFilter] = useState<ListType | ''>('');
  const [expandedVerse, setExpandedVerse] = useState<number | null>(null);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [verseLinks, setVerseLinks] = useState<Record<number, AyahLink[]>>({});
  const [showLinksFor, setShowLinksFor] = useState<number | null>(null);
  // Link audio voice: follows the user's registered gender by default
  // (female → Rana's original recording, male → dignified male synthetic),
  // and the user can switch between the two choices at any time; the
  // choice persists.
  const [profileGender, setProfileGender] = useState<'male' | 'female' | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [preferredName, setPreferredName] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState('');
  const [voicePref, setVoicePref] = useState<'male' | 'female' | null>(() => {
    const saved = localStorage.getItem('quran-link-voice');
    return saved === 'male' || saved === 'female' ? saved : null;
  });
  const effectiveVoice: 'male' | 'female' = voicePref ?? profileGender ?? 'female';
  const setLinkVoice = (v: 'male' | 'female') => {
    setVoicePref(v);
    localStorage.setItem('quran-link-voice', v);
  };
  // Resolve which audio a link plays for a voice choice, labeled by the
  // choice names: female plays Rana's original voice, male plays the
  // dignified human-sounding male synthetic; either falls back to
  // whatever audio the link has, labeled by what it actually is.
  const resolveLinkAudio = (link: AyahLink, voice: 'male' | 'female'): { url: string; label: string } | null => {
    if (voice === 'female') {
      if (link.audio_url) return { url: link.audio_url, label: 'صوت نسائي' };
      if (link.synthetic_audio_url) return { url: link.synthetic_audio_url, label: link.voice_type === 'male' ? 'صوت رجالي' : 'صوت نسائي' };
      return null;
    }
    if (link.synthetic_audio_url && link.voice_type === 'male') return { url: link.synthetic_audio_url, label: 'صوت رجالي' };
    if (link.synthetic_audio_url) return { url: link.synthetic_audio_url, label: 'صوت نسائي' };
    if (link.audio_url) return { url: link.audio_url, label: 'صوت نسائي' };
    return null;
  };
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
      if (profile?.username) setProfileName(profile.username);
      if ((profile as { preferred_name?: string | null } | null)?.preferred_name) setPreferredName((profile as { preferred_name: string }).preferred_name);
    };
    loadGender();
  }, [session]);

  const { lists, toggleList: toggleListRaw } = useUserLists();

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
        const r = e.results[i][0];
        if (r.isFinal) voiceFinalRef.current += r.transcript + ' ';
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
      if (linkTypeFilter) {
        const { data: linkData } = await supabase
          .from('ayah_links')
          .select('verse_id')
          .contains('link_types', [linkTypeFilter])
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
          const ids = searchVerseIds(verses, links, debouncedSearch, {
            surahNo: surahFilter ? parseInt(surahFilter) : null,
            linkType: linkTypeFilter || null,
          });
          if (ids.length === 0) { setVerses([]); setTotalCount(0); setLoading(false); return; }
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
    favorites: lists.favorites.size,
    read_later: lists.read_later.size,
    difficult: lists.difficult.size,
    memorized: lists.memorized.size,
  };

  const activeFiltersCount = (surahFilter ? 1 : 0) + (linkTypeFilter ? 1 : 0) + (debouncedSearch ? 1 : 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-stone-50/30 pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-emerald-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-lg">
              <BookOpen className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-accent-800">{t('appName')}</h1>
              <p className="text-sm text-accent-500">{(preferredName || profileName) ? `لوحة ${preferredName || profileName} — روابط الآيات` : 'لوحتي — روابط الآيات'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button onClick={() => setShowLangMenu(!showLangMenu)}
                className="flex items-center gap-1.5 px-2.5 py-2 text-sm text-accent-600 hover:bg-gray-100 rounded-lg transition-smooth">
                <Globe className="w-5 h-5" />
                {LANGUAGES.find((l) => l.code === lang)?.flag}
              </button>
              {showLangMenu && (
                <div className="absolute left-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-200 p-2 min-w-[150px] z-50 animate-slide-up">
                  {LANGUAGES.map((l) => (
                    <button key={l.code}
                      onClick={() => { setLang(l.code); setShowLangMenu(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-smooth ${
                        lang === l.code ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'hover:bg-gray-50 text-accent-600'
                      }`}>
                      <span>{l.flag}</span>{l.nativeName}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {session && (
              <button onClick={async () => { await signOut(); onNavigate('home'); }}
                className="flex items-center gap-1.5 px-2.5 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-smooth">
                <LogOut className="w-5 h-5" />
              </button>
            )}
            <button onClick={() => onNavigate('mushaf')}
              className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-amber-700 hover:bg-amber-50 rounded-lg transition-smooth font-semibold border border-amber-200">
              <BookMarked className="w-5 h-5" /> المصحف
            </button>
            <button onClick={() => onNavigate('home')}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-accent-600 hover:bg-gray-100 rounded-lg transition-smooth">
              <Home className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Personal greeting — just the salam (the board name is
            already clear in the header above, so it is not repeated
            here), a one-line reminder, and a personal dua */}
        <div className="mb-5 bg-gradient-to-l from-emerald-600 to-teal-700 rounded-2xl p-5 shadow-lg text-white">
          <div className="flex items-center gap-2">
            <Heart className="w-5 h-5 flex-shrink-0 text-emerald-100" />
            <p className="text-lg font-bold leading-relaxed">
              {ISLAMIC_GREETING}
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
                className="flex-1 px-3 py-2 rounded-xl text-sm text-accent-800 bg-white/95 border border-emerald-200 focus:outline-none" />
              <button onClick={savePreferredName} className="px-3 py-2 bg-white text-emerald-700 text-sm font-bold rounded-xl">حفظ</button>
              <button onClick={() => setEditingName(false)} className="px-3 py-2 text-sm text-emerald-100">إلغاء</button>
            </div>
          )}
          {nameError && <p className="text-xs text-red-200 mt-2">{nameError}</p>}
          <p className="text-sm text-emerald-50 leading-relaxed mt-2">
            {(listCounts.favorites + listCounts.read_later + listCounts.difficult + listCounts.memorized) > 0
              ? `ما شاء الله، بارك الله فيك — جمعت ${(listCounts.favorites + listCounts.read_later + listCounts.difficult + listCounts.memorized).toLocaleString('ar-EG')} آية في قوائمك${listCounts.memorized > 0 ? `، وحفظت ${listCounts.memorized.toLocaleString('ar-EG')} آية` : ''}، تقبل الله منك وثبّتها في قلبك`
              : 'استحضر النية'}
          </p>
          <p className="text-sm text-amber-100 font-semibold leading-relaxed mt-3 pt-3 border-t border-white/20">
            {(preferredName || profileName) ? `${dailyDua()} يا ${preferredName || profileName}` : dailyDua()}
          </p>
        </div>

        {/* Progress Widget */}
        <div className="mb-5">
          <ProgressWidget />
        </div>

        {/* Daily wird + self-test entry */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          <DailyWird onNavigate={onNavigate} />
          <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <Mic className="w-5 h-5 text-emerald-600" />
              <h2 className="font-bold text-accent-800">سمّع لنفسك</h2>
            </div>
            <p className="text-sm text-accent-500 leading-relaxed flex-1">
              بالميكروفون: اختر سورة وآيات، سمّع من حفظك والبرنامج يصحح لك — الصح يظهر بالأخضر، والغلط تاخد فرصة ٥ ثواني وبعدها يظهر الجزء الغلط بالأحمر. وفي النهاية نتيجتك والآيات اللي تحتاج مراجعة.
            </p>
            <button onClick={() => onNavigate('test')}
              className="mt-4 w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl">
              ابدأ التسميع
            </button>
          </div>
        </div>

        {/* List filter tabs */}
        {session && (
          <div className="flex gap-2 mb-4 flex-wrap">
            <ListFilterTab active={listFilter === ''} onClick={() => { setListFilter(''); setPage(0); }}
              label={t('allStatus')} icon={<BookOpen className="w-5 h-5" />} />
            <ListFilterTab active={listFilter === 'favorites'} onClick={() => { setListFilter('favorites'); setPage(0); }}
              label={t('favorites')} icon={<Heart className="w-5 h-5" />} count={listCounts.favorites} />
            <ListFilterTab active={listFilter === 'read_later'} onClick={() => { setListFilter('read_later'); setPage(0); }}
              label={t('readLater')} icon={<Bookmark className="w-5 h-5" />} count={listCounts.read_later} />
            <ListFilterTab active={listFilter === 'difficult'} onClick={() => { setListFilter('difficult'); setPage(0); }}
              label={t('difficult')} icon={<AlertTriangle className="w-5 h-5" />} count={listCounts.difficult} />
            <ListFilterTab active={listFilter === 'memorized'} onClick={() => { setListFilter('memorized'); setPage(0); }}
              label="تم الحفظ" icon={<BadgeCheck className="w-5 h-5" />} count={listCounts.memorized} />
          </div>
        )}

        {/* Filter toggle bar */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm mb-4 overflow-hidden">
          <button onClick={() => setShowFilters(!showFilters)}
            className="w-full flex items-center justify-between p-4 text-right">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-emerald-600" />
              <span className="text-base font-bold text-accent-800">أدوات الفلترة</span>
              {activeFiltersCount > 0 && (
                <span className="flex items-center justify-center w-6 h-6 bg-emerald-600 text-white text-xs font-bold rounded-full">
                  {activeFiltersCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {(search || surahFilter || linkTypeFilter) && (
                <button onClick={(e) => { e.stopPropagation(); setSearch(''); setSurahFilter(''); setLinkTypeFilter(''); setPage(0); }}
                  className="text-sm text-red-500 hover:text-red-600 font-semibold">
                  مسح الكل
                </button>
              )}
              <ChevronLeft className={`w-5 h-5 text-accent-400 transition-transform ${showFilters ? '-rotate-90' : ''}`} />
            </div>
          </button>

          {showFilters && (
            <div className="px-4 pb-4 space-y-3 animate-slide-up border-t border-gray-50 pt-4">
              {/* Search */}
              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5">بحث في الآيات والروابط</label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input type="text" value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                    placeholder={t('search')}
                    className="w-full pr-11 pl-12 py-3 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:border-emerald-500 transition-smooth" />
                  <button type="button" onClick={toggleVoiceSearch}
                    title={isListening ? 'إيقاف الاستماع' : 'بحث صوتي'}
                    className={`absolute left-2 top-1/2 -translate-y-1/2 p-2.5 rounded-full transition-smooth shadow-sm ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
                    <Mic className="w-6 h-6" />
                  </button>
                </div>
                {searchHint && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200 mt-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {searchHint}
                  </div>
                )}
                <p className="text-[11px] text-accent-400 mt-1.5">يقبل البحث الرسم العثماني والإملائي — اكتب كما تنطق، وسيجد الآيات حتى لو اختلف رسم الكلمة.</p>
              </div>

              {/* Surah selection */}
              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5">اختر السورة</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-[200px] overflow-y-auto p-1">
                  <button onClick={() => { setSurahFilter(''); setPage(0); }}
                    className={`p-2.5 rounded-lg text-sm font-semibold transition-smooth border ${
                      surahFilter === '' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-accent-600 border-gray-200 hover:border-emerald-300'
                    }`}>
                    كل السور
                  </button>
                  {SURAHS.map((s) => (
                    <button key={s.no} onClick={() => { setSurahFilter(String(s.no)); setPage(0); }}
                      className={`flex items-center gap-1.5 p-2.5 rounded-lg text-sm font-semibold transition-smooth border ${
                        surahFilter === String(s.no) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-accent-600 border-gray-200 hover:border-emerald-300'
                      }`}>
                      <span className="text-xs opacity-60">{s.no}.</span>
                      <span className="truncate">{s.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Link type filter */}
              <div>
                <label className="block text-sm font-semibold text-accent-700 mb-1.5 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-emerald-600" /> نوع الرابط
                </label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => { setLinkTypeFilter(''); setPage(0); }}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold transition-smooth border ${
                      linkTypeFilter === '' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-accent-600 border-gray-200 hover:border-emerald-300'
                    }`}>
                    كل الأنواع
                  </button>
                  {LINK_TYPES.map((lt) => (
                    <button key={lt.value} onClick={() => { setLinkTypeFilter(lt.value); setPage(0); }}
                      className={`px-3 py-2 rounded-lg text-sm font-semibold transition-smooth border ${
                        linkTypeFilter === lt.value ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-accent-600 border-gray-200 hover:border-emerald-300'
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
          <p className="text-sm text-accent-500">
            {loading ? 'جارٍ التحميل...' : `${totalCount} آية`}
          </p>
        </div>

        {/* Verses list */}
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <div className="w-12 h-12 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
          </div>
        ) : verses.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 py-20 text-center shadow-sm">
            <BookOpen className="w-14 h-14 text-gray-300 mx-auto mb-3" />
            <p className="text-base text-accent-400">{listFilter ? 'لا توجد آيات في هذه القائمة' : t('noLinksYet')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {verses.map((verse) => {
              const isExpanded = expandedVerse === verse.id;
              const links = verseLinks[verse.id] || [];
              return (
                <div
                  key={verse.id}
                  onTouchStart={() => handleLongPressStart(verse)}
                  onTouchEnd={handleLongPressClear}
                  onTouchMove={handleLongPressClear}
                  className="bg-white rounded-2xl border border-emerald-100 overflow-hidden shadow-sm hover:shadow-md transition-smooth animate-fade-in"
                >
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="flex items-center justify-center w-8 h-8 bg-emerald-100 text-emerald-700 text-sm font-bold rounded-lg">
                            {verse.surah_no}:{verse.ayah_no}
                          </span>
                          <span className="text-base font-semibold text-accent-700">{verse.surah_name}</span>
                        </div>
                        <p className="font-arabic text-2xl text-accent-800 leading-loose">
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
                            showLinksFor === verse.id ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-50 text-accent-600 hover:bg-gray-100'
                          }`}
                        >
                          <Bookmark className="w-5 h-5" />
                          {verse.links_count} {t('linksCount')}
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExpandedVerse(isExpanded ? null : verse.id)}
                          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-smooth ${
                            isExpanded ? 'bg-violet-100 text-violet-700' : 'bg-gray-50 text-accent-600 hover:bg-gray-100'
                          }`}
                        >
                          إعادة صياغة
                        </button>
                        <button
                          onClick={() => {
                            try {
                              localStorage.setItem('quran-mushaf-target', JSON.stringify({ surah: verse.surah_no, ayah: verse.ayah_no }));
                            } catch { /* storage unavailable: still navigate to the Mushaf */ }
                            onNavigate('mushaf');
                          }}
                          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-smooth bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                        >
                          <BookMarked className="w-5 h-5" />
                          فتح في المصحف
                        </button>
                        <ShareButton verseText={verse.ayah_text} surahName={verse.surah_name} ayahNo={verse.ayah_no} />
                      </div>
                    </div>

                    {/* Links display */}
                    {showLinksFor === verse.id && links.length > 0 && (
                      <div className="mt-4 space-y-2 animate-slide-up">
                        <div className="flex items-center gap-2 flex-wrap bg-white rounded-lg px-3 py-2 border border-gray-100">
                          <span className="text-xs font-semibold text-accent-500">اسمع بـ:</span>
                          <button onClick={() => setLinkVoice('female')}
                            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-smooth ${effectiveVoice === 'female' ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-accent-600 hover:bg-gray-100'}`}>
                            صوت نسائي
                          </button>
                          <button onClick={() => setLinkVoice('male')}
                            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-smooth ${effectiveVoice === 'male' ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-accent-600 hover:bg-gray-100'}`}>
                            صوت رجالي
                          </button>
                          <span className="text-[11px] text-accent-400">الافتراضي حسب حسابك، وتقدر تغيّره في أي وقت</span>
                        </div>
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
                                <p className="font-semibold text-accent-700 mb-1 text-base">{link.link_title}</p>
                              )}
                              <p className="text-accent-600 leading-relaxed text-base">{link.link_content}</p>
                              {(() => {
                                const audio = resolveLinkAudio(link, effectiveVoice);
                                if (!audio) return null;
                                return (
                                  <button onClick={() => new Audio(audio.url).play()}
                                    className="flex items-center gap-1 text-xs text-emerald-600 hover:underline mt-1">
                                    <Volume2 className="w-4 h-4" /> استماع ({audio.label})
                                  </button>
                                );
                              })()}
                            </div>
                            <span className="text-xs text-gray-300 hidden sm:inline">اضغط مطولاً للقائمة</span>
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
          <div className="flex items-center justify-between mt-4 bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
            <p className="text-sm text-accent-500">
              {page + 1} / {totalPages}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                className="p-2 text-accent-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 transition-smooth">
                <ChevronRight className="w-5 h-5" />
              </button>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                className="p-2 text-accent-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 transition-smooth">
                <ChevronLeft className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* QR Codes */}
        <div className="mt-8">
          <QRCodeSection />
        </div>
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
          onAddToList={toggleList}
          onClose={() => setLongPressLink(null)}
        />
      )}
    </div>
  );
}

function ListFilterTab({ active, onClick, label, icon, count }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl transition-smooth ${
        active ? 'bg-emerald-600 text-white shadow-md' : 'bg-white text-accent-600 hover:bg-gray-50 border border-gray-200'
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
    adadi: 'bg-amber-100 text-amber-700',
    maqam: 'bg-indigo-100 text-indigo-700',
    takrir: 'bg-rose-100 text-rose-700',
  };
  return colors[type] || 'bg-gray-100 text-gray-700';
}
