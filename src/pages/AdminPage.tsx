import { blankMarks } from '../lib/arabicNormalize';
import DrumSelect from '../components/DrumSelect';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useEscapeClose } from '../lib/useEscape';
import { supabase } from '../lib/supabase';
import { loadVerseIndex, searchVerseIds } from '../lib/searchIndex';
import { signOut } from '../lib/auth';
import type { Session } from '@supabase/supabase-js';
import type { QuranVerse, VerseFilter, AyahLink } from '../lib/types';
import { TOTAL_VERSES, LINK_TYPES } from '../lib/types';
import { formatAr } from '../lib/numerals';
import { SURAHS } from '../lib/surahs';
import {
  BookOpen, LogOut, Search, Bookmark, Trash2,
  ChevronRight, ChevronLeft, Download, Filter, X,
  Check, Layers, RefreshCw, Volume2, Clock, AlertCircle, AudioLines, User, Users, Heart, Loader2, Mic, Menu, BarChart3, PenLine, Lightbulb, Library,
} from 'lucide-react';
import CircularProgressIndicator from '../components/CircularProgressIndicator';
import LinkModal from '../components/LinkModal';
import FarLinkPicker from '../components/FarLinkPicker';
import { madinahPageOfAyah } from '../lib/madinahPageStarts';
import type { Route } from '../lib/routes';
import { askConfirm } from '../lib/confirmSheet';
import StatCard from '../components/admin/StatCard';
import AdminsPanel from '../components/admin/AdminsPanel';


const PAGE_SIZE = 25;

// Arabic labels for the OpenAI usage monitor.
const USAGE_LABELS: Record<string, string> = {
  'smart-rephrase': 'إعادة الصياغة',
  'transcribe-audio': 'تحويل الصوت لنص',
  'generate-voice': 'توليد الصوت',
};

export default function AdminPage({ session, onNavigate }: { session: Session | null; onNavigate: (r: Route) => void }) {
  const [verses, setVerses] = useState<QuranVerse[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState('');
  const [surahFilter, setSurahFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<VerseFilter>('all');
  const [stats, setStats] = useState({ withLinks: 0, withoutLinks: 0 });
  // OpenAI balance monitor (estimated from app-side usage logging).
  const [usage, setUsage] = useState<{ total: number; calls: number; byFn: Record<string, { calls: number; cost: number }> } | null>(null);
  // User-account counts (2026-10-28, Amr's request): served by the
  // admin-only get_user_stats RPC, so the browser never touches
  // auth.users directly.
  const [userStats, setUserStats] = useState<{ total: number; confirmed: number; signed_in: number; new_30d: number } | null>(null);
  const [userStatsError, setUserStatsError] = useState('');
  const [startingBalance, setStartingBalance] = useState(5);
  const [balanceDraft, setBalanceDraft] = useState('5');
  const [editingBalance, setEditingBalance] = useState(false);
  // Dashboard sub-doors (2026-11-08): one panel open at a time, all closed by default.
  const [openPanel, setOpenPanel] = useState<'progress' | 'users' | 'openai' | 'records' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [usageError, setUsageError] = useState('');
  const [linkModalVerse, setLinkModalVerse] = useState<QuranVerse | null>(null);
  // Merge (any number of consecutive ayat of one surah -> ONE link) and far link (ayah <-> any other ayah).
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSel, setMergeSel] = useState<QuranVerse[]>([]);
  const [linkModalGroup, setLinkModalGroup] = useState<QuranVerse[] | undefined>(undefined);
  const [linkModalRelated, setLinkModalRelated] = useState<QuranVerse | null>(null);
  const [farFrom, setFarFrom] = useState<QuranVerse | null>(null);
  // usernames of suggested-link authors (admin-only RPC) + queue filter
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const [pendingFilter, setPendingFilter] = useState<'drafts' | 'users' | 'books'>('drafts');
  // records panel (loaded lazily when opened)
  const [rec, setRec] = useState<null | { links: number; merged: number; far: number; versesLinked: number; pages: number; today: number; bestDay: { day: string; n: number } | null; longestMerge: number; byUsers: number; byAdmins: number }>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [verseLinks, setVerseLinks] = useState<AyahLink[]>([]);
  const [showLinksFor, setShowLinksFor] = useState<number | null>(null);

  const [pendingLinks, setPendingLinks] = useState<AyahLink[]>([]);
  const [pendingVerses, setPendingVerses] = useState<Record<number, QuranVerse>>({});
  const [showPending, setShowPending] = useState(false);
  useEscapeClose(showPending, () => setShowPending(false));
  // Pending queue pagination: the queue renders cards with inputs and
  // voice buttons, so showing hundreds at once would freeze the page.
  // Rana sees 50 at a time and loads more on demand.
  const [bucketCounts, setBucketCounts] = useState<{ drafts: number; users: number; books: number } | null>(null);
  const [pendingHasMore, setPendingHasMore] = useState(false);
  // 16.12: which top tab is open (kept for this session).
  const [adminTab, setAdminTab] = useState<'review' | 'verses' | 'stats' | 'admins'>(() => {
    try { const t = sessionStorage.getItem('quran-admin-tab'); return t === 'verses' || t === 'stats' || t === 'admins' ? t : 'review'; } catch { return 'review'; }
  });
  const [rephrasingId, setRephrasingId] = useState<number | null>(null);
  // S5: per-card rephrase input (was one shared string, so typing in
  // card A sent from card B). Keyed by pending-link id.
  const [rephraseCmds, setRephraseCmds] = useState<Record<number, string>>({});
  // S5: busy map for approve/reject/delete/edit/voice/proposal actions
  // (was: no disable-while-saving, so double taps double-fired).
  const [savingIds, setSavingIds] = useState<Record<number, boolean>>({});
  const setSaving = (id: number, v: boolean) =>
    setSavingIds((prev) => ({ ...prev, [id]: v }));
  // S5: action failure surfaced in place (was: a failed update looked
  // identical to success until the next refetch).
  const [adminError, setAdminError] = useState('');
  // S5: queue-load failure must NOT look like "no pending links".
  const [pendingError, setPendingError] = useState('');
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [pendingLoading, setPendingLoading] = useState(false);
  // S5 (V10): admin membership set for the queue badge. is_ai_draft
  // defaults to false, so admin LinkModal rows and user suggestions
  // are indistinguishable on that column alone; the badge below uses
  // this set (+ absence of an original recording) instead.
  const [adminIds, setAdminIds] = useState<Set<string> | null>(null);
  // AI proposals awaiting the admin's decision (per pending link).
  // A proposal is NOT written to the database until the admin approves
  // it, so re-requesting never destroys the current text.
  const [proposals, setProposals] = useState<Record<number, { text: string; command: string }>>({});
  const [generatingVoiceId, setGeneratingVoiceId] = useState<number | null>(null);
  const [editingLinkId, setEditingLinkId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [firstUnlinkedId, setFirstUnlinkedId] = useState<number | null>(null);
  const [showRanaArrow, setShowRanaArrow] = useState(true);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchHint, setSearchHint] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const trimmed = search.trim();
    // A spoken / typed surah name ("الجاثية", "سورة البقرة") jumps straight to that surah.
    const norm = (t: string) => t.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/^سور[هة]\s+/, '').replace(/^ال/, '').trim();
    if (trimmed && !/^\d/.test(trimmed)) {
      const q = norm(trimmed);
      const hit = SURAHS.find((x) => norm(x.name.replace(/^سورة\s+/, '')) === q);
      if (hit) { setSurahFilter(String(hit.no)); setSearch(''); setPage(0); return; }
    }
    const isNumber = /^\d+$/.test(trimmed);
    const isColonFormat = /^\d+\s*[:：]\s*\d+$/.test(trimmed);

    if (isNumber || isColonFormat || trimmed === '') {
      setDebouncedSearch(trimmed);
      setSearchHint('');
      return;
    }

    debounceTimer.current = setTimeout(() => {
      // No minimum word count anymore: the cross-rasm index search
      // matches even a single word, in any spelling.
      setSearchHint('');
      setDebouncedSearch(trimmed);
    }, 500);

    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [search]);

  const loadUsage = useCallback(async () => {
    const { data, error } = await supabase.from('ai_usage_events').select('function_name, cost_usd');
    if (error || !data) { setUsage(null); return; }
    const byFn: Record<string, { calls: number; cost: number }> = {};
    let total = 0;
    data.forEach((r) => {
      const cost = Number(r.cost_usd || 0);
      total += cost;
      const f = byFn[r.function_name] || { calls: 0, cost: 0 };
      f.calls += 1; f.cost += cost; byFn[r.function_name] = f;
    });
    setUsage({ total, calls: data.length, byFn });
    const { data: setting } = await supabase.from('app_settings').select('value').eq('key', 'openai_starting_balance').single();
    const parsed = setting ? parseFloat(setting.value) : NaN;
    const bal = isNaN(parsed) ? 5 : parsed;
    setStartingBalance(bal);
    setBalanceDraft(String(bal));
  }, []);

  useEffect(() => { loadUsage(); }, [loadUsage]);

  const saveStartingBalance = async () => {
    const v = parseFloat(balanceDraft);
    if (isNaN(v) || v < 0) { setUsageError('اكتب رقم صحيح للرصيد'); return; }
    const { error } = await supabase.from('app_settings').upsert({ key: 'openai_starting_balance', value: String(v) });
    if (error) { setUsageError('تعذر حفظ الرصيد'); return; }
    setStartingBalance(v);
    setEditingBalance(false);
    setUsageError('');
  };

  const fetchVerses = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('quran_verses').select('*', { count: 'exact' });

    if (debouncedSearch) {
      const colonMatch = debouncedSearch.match(/^(\d+)\s*[:：]\s*(\d+)$/);
      const searchNum = parseInt(debouncedSearch);
      if (colonMatch) {
        query = query.eq('surah_no', parseInt(colonMatch[1])).eq('ayah_no', parseInt(colonMatch[2]));
      } else if (!isNaN(searchNum) && debouncedSearch.toString().trim() === searchNum.toString()) {
        query = query.or(`ayah_no.eq.${searchNum},surah_no.eq.${searchNum},id.eq.${searchNum}`);
      } else {
        // Cross-rasm index search (1+ words, Uthmani/imla'i tolerant,
        // same normalized index as the user search). The number and
        // surah:ayah shortcuts above are unchanged.
        try {
          const verses = await loadVerseIndex();
          const ids = searchVerseIds(verses, [], debouncedSearch, {
            surahNo: surahFilter ? parseInt(surahFilter) : null,
            hasLinks: statusFilter === 'green' ? true : statusFilter === 'red' ? false : null,
          });
          const pageIds = ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
          const { data: pageData } = await supabase.from('quran_verses').select('*').in('id', pageIds).order('id', { ascending: true });
          setVerses(pageData || []);
          setTotalCount(ids.length);
        } catch {
          setVerses([]);
          setTotalCount(0);
        }
        setLoading(false);
        return;
      }
    }
    if (surahFilter) query = query.eq('surah_no', parseInt(surahFilter));
    if (statusFilter === 'green') query = query.eq('has_links', true);
    else if (statusFilter === 'red') query = query.or('has_links.eq.false,has_links.is.null');

    query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1).order('id', { ascending: true });

    const { data, count, error } = await query;
    if (error) {
      console.error('Error fetching verses:', error);
    } else {
      setVerses(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  }, [debouncedSearch, surahFilter, statusFilter, page]);

  const fetchStats = useCallback(async () => {
    const [{ count: total }, { count: withLinks }] = await Promise.all([
      supabase.from('quran_verses').select('*', { count: 'exact', head: true }),
      supabase.from('quran_verses').select('*', { count: 'exact', head: true }).eq('has_links', true),
    ]);
    const totalRows = total || 0;
    const withCount = withLinks || 0;
    // "Without links" = every ayah not marked as linked, including rows
    // whose has_links is still NULL, so with + without always equals the
    // total number of ayahs in the table.
    setStats({ withLinks: withCount, withoutLinks: Math.max(0, totalRows - withCount) });
  }, []);

  // 6.19 (owner approval 2026-11-26): the queue is paged on the server, 50
  // rows at a time per bucket, instead of downloading all ~6,237 drafts and
  // showing 50. The bucket is ayah_links.source (filled for every row and set
  // on insert by migration 20261126000010): 'books'; 'user' without a
  // recording = a user suggestion; everything else (AI drafts, admin work, a
  // user row with a recording) = drafts. The three counts are head-only.
  const PENDING_PAGE = 50;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic PostgREST builder types blow up (TS2589)
  const bucketFilter = (q: any, k: 'drafts' | 'users' | 'books'): any =>
    k === 'books' ? q.eq('source', 'books')
      : k === 'users' ? q.eq('source', 'user').is('audio_url', null)
        : q.or('source.is.null,source.in.(ai,admin),and(source.eq.user,audio_url.not.is.null)');
  const pendingFilterRef = useRef(pendingFilter);
  pendingFilterRef.current = pendingFilter;
  const pendingLenRef = useRef(0);
  pendingLenRef.current = pendingLinks.length;

  const fetchPendingCounts = useCallback(async () => {
    const keys = ['drafts', 'users', 'books'] as const;
    const res = await Promise.all(keys.map((k) => bucketFilter(supabase.from('ayah_links').select('id', { count: 'exact', head: true }).eq('status', 'pending'), k)));
    if (res.some((r) => r.error)) return;
    setBucketCounts({ drafts: res[0].count ?? 0, users: res[1].count ?? 0, books: res[2].count ?? 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPendingLinks = useCallback(async (opts?: { bucket?: 'drafts' | 'users' | 'books'; append?: boolean }) => {
    // S5: a failed load sets pendingError and KEEPS the previous list.
    const k = opts?.bucket ?? pendingFilterRef.current;
    const from = opts?.append ? pendingLenRef.current : 0;
    setPendingLoading(true);
    setPendingError('');
    if (!opts?.append) void fetchPendingCounts();
    const { data, error } = await bucketFilter(supabase
      .from('ayah_links')
      .select(`*, quran_verses!inner(id, surah_no, surah_name, ayah_no, ayah_text)`)
      .eq('status', 'pending'), k)
      .order('created_at', { ascending: false })
      .range(from, from + PENDING_PAGE - 1);
    if (error || !data) {
      setPendingError('تعذّر تحميل قائمة المراجعة — تحقق من الاتصال وحاول تاني. القائمة المعروضة (لو فيه) قديمة.');
      setPendingLoading(false);
      return;
    }
    const rows = data as unknown as (AyahLink & { quran_verses?: QuranVerse })[];
    setPendingLinks((prev) => (opts?.append ? [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))] : rows));
    setPendingVerses((prev) => {
      const verseMap: Record<number, QuranVerse> = opts?.append ? { ...prev } : {};
      rows.forEach((d) => { if (d.quran_verses) verseMap[d.verse_id] = d.quran_verses; });
      return verseMap;
    });
    setPendingHasMore(rows.length === PENDING_PAGE);
    setPendingLoaded(true);
    setPendingLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPendingCounts]);

  useEffect(() => { fetchVerses(); }, [fetchVerses]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchPendingLinks(); }, [fetchPendingLinks]);

  // S5 (V10): admin membership for the queue badge. If this fetch
  // fails, adminIds stays null and the badge is hidden rather than
  // shown on uncertain data — never guess "user suggestion" for a row
  // whose creator is unknown. NOTE: any non-error response is treated
  // as complete, and with select-own-only RLS the set is in practice
  // just the viewer — so another admin's text-only row could slip past
  // signal 1 and be misbadged; the durable fix is a DB source column.
  useEffect(() => {
    if (!session?.user?.id) return;
    supabase.from('admin_users').select('user_id').then(({ data, error }) => {
      if (!error && data) setAdminIds(new Set(data.map((r: { user_id: string }) => r.user_id)));
    });
  }, [session?.user?.id]);

  const fetchUserStats = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_user_stats');
    if (error || !data || data.length === 0) {
      setUserStatsError('تعذّر تحميل عدد المستخدمين');
      return;
    }
    setUserStats(data[0] as { total: number; confirmed: number; signed_in: number; new_30d: number });
    setUserStatsError('');
  }, []);
  useEffect(() => { fetchUserStats(); }, [fetchUserStats]);

  // Admin-only numbers: links, ayat linked, Mushaf pages covered, records. Loaded when the panel opens.
  const loadRecords = useCallback(async () => {
    setRecLoading(true);
    try {
      const links: { verse_id: number; group_verse_ids: number[] | null; related_verse_id: number | null; created_at: string; created_by: string | null; is_ai_draft: boolean | null; audio_url: string | null }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('ayah_links')
          .select('verse_id,group_verse_ids,related_verse_id,created_at,created_by,is_ai_draft,audio_url')
          .eq('status', 'approved').order('id', { ascending: true }).range(from, from + 999);
        if (error || !data) throw error;
        links.push(...(data as typeof links));
        if (data.length < 1000) break;
      }
      const idToAyah = new Map<number, [number, number]>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('quran_verses').select('id,surah_no,ayah_no').order('id', { ascending: true }).range(from, from + 999);
        if (error || !data) throw error;
        data.forEach((r) => idToAyah.set(r.id as number, [r.surah_no as number, r.ayah_no as number]));
        if (data.length < 1000) break;
      }
      const linked = new Set<number>();
      let merged = 0, far = 0, longest = 1;
      const perDay: Record<string, number> = {};
      const todayKey = new Date().toISOString().slice(0, 10);
      const adminSet = adminIds;
      let byUsers = 0;
      links.forEach((l) => {
        linked.add(l.verse_id);
        if (l.group_verse_ids && l.group_verse_ids.length > 1) { merged++; l.group_verse_ids.forEach((v) => linked.add(v)); longest = Math.max(longest, l.group_verse_ids.length); }
        if (l.related_verse_id) { far++; linked.add(l.related_verse_id); }
        const day = (l.created_at || '').slice(0, 10);
        if (day) perDay[day] = (perDay[day] || 0) + 1;
        if (adminSet && l.created_by && !adminSet.has(l.created_by) && !l.audio_url && !l.is_ai_draft) byUsers++;
      });
      const pages = new Set<number>();
      linked.forEach((id) => { const a = idToAyah.get(id); if (a) pages.add(madinahPageOfAyah(a[0], a[1])); });
      const best = Object.entries(perDay).sort((a, b) => b[1] - a[1])[0];
      setRec({
        links: links.length, merged, far, versesLinked: linked.size, pages: pages.size,
        today: perDay[todayKey] || 0, bestDay: best ? { day: best[0], n: best[1] } : null,
        longestMerge: longest, byUsers, byAdmins: links.length - byUsers,
      });
    } catch {
      setAdminError('تعذّر تحميل الأرقام — حاول تاني.');
    }
    setRecLoading(false);
  }, [adminIds]);
  useEffect(() => { if (openPanel === 'records' && !rec && !recLoading) loadRecords(); }, [openPanel, rec, recLoading, loadRecords]);

  // Usernames for the review queue (only the authors of non-admin rows).
  useEffect(() => {
    if (!showPending || !adminIds) return;
    const ids = Array.from(new Set(pendingLinks.map((l) => l.created_by).filter((x): x is string => !!x && !adminIds.has(x) && !(x in authors))));
    if (ids.length === 0) return;
    supabase.rpc('admin_link_authors', { ids }).then(({ data, error }) => {
      if (error || !data) return;
      setAuthors((cur) => { const n = { ...cur }; (data as { user_id: string; username: string | null; display_name: string | null }[]).forEach((r) => { n[r.user_id] = r.username || r.display_name || 'مستخدم'; }); ids.forEach((i) => { if (!(i in n)) n[i] = 'مستخدم'; }); return n; });
    });
  }, [showPending, pendingLinks, adminIds, authors]);
  useEffect(() => { fetchStats(); }, [fetchStats, verses]);

  useEffect(() => {
    if (!debouncedSearch && !surahFilter && statusFilter !== 'green' && page === 0) {
      supabase
        .from('quran_verses')
        .select('id')
        .or('has_links.eq.false,has_links.is.null')
        .order('id', { ascending: true })
        .limit(1)
        .single()
        .then(({ data }) => {
          if (data) setFirstUnlinkedId(data.id);
        });
    } else {
      setFirstUnlinkedId(null);
    }
  }, [debouncedSearch, surahFilter, statusFilter, page, stats.withoutLinks]);

  const fetchVerseLinks = async (verseId: number) => {
    const { data } = await supabase.from('ayah_links').select('*').eq('verse_id', verseId);
    setVerseLinks(data || []);
  };

  // S5: remove a decided row from local state at once. The queue
  // is NOT re-downloaded per action (was: every approve/reject
  // re-fetched all 6,236 rows). Only the cheap head-count stats are
  // refreshed after an approval, since publication moves the counts;
  // the full queue reloads on demand via "تحديث القائمة".
  const removePendingLocal = (linkId: number) => {
    const removed = pendingLinks.find((l) => l.id === linkId);
    if (removed) setBucketCounts((c) => (c ? { ...c, [pendingFilter]: Math.max(0, c[pendingFilter] - 1) } : c));
    setPendingLinks((prev) => prev.filter((l) => l.id !== linkId));
    if (removed && !pendingLinks.some((l) => l.id !== linkId && l.verse_id === removed.verse_id)) {
      setPendingVerses((prev) => {
        const next = { ...prev };
        delete next[removed.verse_id];
        return next;
      });
    }
    setProposals((prev) => {
      if (!(linkId in prev)) return prev;
      const next = { ...prev };
      delete next[linkId];
      return next;
    });
  };

  const deleteLink = async (linkId: number) => {
    if (!(await askConfirm({ text: 'حذف هذا التربيط نهائيًا؟ لا يمكن التراجع.', confirmLabel: 'احذف', danger: true }))) return;
    if (savingIds[linkId]) return;
    setSaving(linkId, true);
    setAdminError('');
    const { error } = await supabase.from('ayah_links').delete().eq('id', linkId);
    if (error) {
      setAdminError('تعذّر حذف التربيط — لم يتغير شيء، حاول تاني.');
    } else {
      if (showLinksFor) fetchVerseLinks(showLinksFor);
      fetchVerses();
    }
    setSaving(linkId, false);
  };

  const approveLink = async (linkId: number) => {
    if (savingIds[linkId]) return;
    setSaving(linkId, true);
    setAdminError('');
    const { error } = await supabase.from('ayah_links').update({ status: 'approved' }).eq('id', linkId);
    if (error) {
      setAdminError('تعذّر نشر التربيط — لم يتغير شيء، حاول تاني.');
    } else {
      removePendingLocal(linkId);
      fetchStats();
    }
    setSaving(linkId, false);
  };

  const rejectLink = async (linkId: number) => {
    if (!(await askConfirm({ text: 'رفض هذا التربيط؟ سيختفي من قائمة المراجعة ولن يظهر للمستخدمين.', confirmLabel: 'ارفض', danger: true }))) return;
    if (savingIds[linkId]) return;
    setSaving(linkId, true);
    setAdminError('');
    const { error } = await supabase.from('ayah_links').update({ status: 'rejected' }).eq('id', linkId);
    if (error) {
      setAdminError('تعذّر رفض التربيط — لم يتغير شيء، حاول تاني.');
    } else {
      removePendingLocal(linkId);
    }
    setSaving(linkId, false);
  };

  const rephrasePending = async (link: AyahLink) => {
    const cmd = rephraseCmds[link.id] || '';
    setRephrasingId(link.id);
    setAdminError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/smart-rephrase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ''}` },
        body: JSON.stringify({ text: link.link_content, command: cmd || undefined, mode: 'rephrase' }),
      });
      if (!res.ok) throw new Error('فشل');
      const data = await res.json();
      const newText = data.rephrased || link.link_content;
      // Proposal only: the admin approves it, discards it, or asks
      // for another version. The stored text is untouched until approval.
      setProposals((prev) => ({ ...prev, [link.id]: { text: newText, command: cmd } }));
      setRephraseCmds((prev) => ({ ...prev, [link.id]: '' }));
    } catch {
      setAdminError('تعذّر إعادة الصياغة — حاول تاني.');
    }
    setRephrasingId(null);
  };

  // Approve a proposed AI version: only now is it written to the DB.
  const applyProposal = async (linkId: number) => {
    const proposal = proposals[linkId];
    if (!proposal || savingIds[linkId]) return;
    setSaving(linkId, true);
    setAdminError('');
    const { error } = await supabase.from('ayah_links').update({ link_content: proposal.text, rephrase_command: proposal.command || null }).eq('id', linkId);
    if (error) {
      setAdminError('تعذّر حفظ الصياغة المقترحة — النص الأصلي محفوظ، حاول تاني.');
    } else {
      setPendingLinks((prev) => prev.map((l) => (l.id === linkId ? { ...l, link_content: proposal.text, rephrase_command: proposal.command || null } : l)));
      setProposals((prev) => { const next = { ...prev }; delete next[linkId]; return next; });
    }
    setSaving(linkId, false);
  };

  const discardProposal = (linkId: number) => {
    setProposals((prev) => { const next = { ...prev }; delete next[linkId]; return next; });
  };

  const startEditText = (link: AyahLink) => { setEditingLinkId(link.id); setEditText(link.link_content); };

  const saveEditText = async (linkId: number) => {
    if (savingIds[linkId]) return;
    setSaving(linkId, true);
    setAdminError('');
    const { error } = await supabase.from('ayah_links').update({ link_content: editText.trim() }).eq('id', linkId);
    if (error) {
      setAdminError('تعذّر حفظ النص المعدّل — حاول تاني.');
    } else {
      setPendingLinks((prev) => prev.map((l) => (l.id === linkId ? { ...l, link_content: editText.trim() } : l)));
      setEditingLinkId(null);
    }
    setSaving(linkId, false);
  };

  const generateVoiceForLink = async (link: AyahLink, voice: 'male' | 'female') => {
    setGeneratingVoiceId(link.id);
    try {
      // Voice source (2026-10-28): the synthetic says the same words
      // as the original recording by default. Only when the link text
      // was deliberately edited after recording — link_content differs
      // from original_transcript, which only happens through a saved
      // modal choice or a direct admin edit — does the synthetic
      // follow the edited text ("edit, then make again").
      const srcText = link.original_transcript && link.link_content !== link.original_transcript
        ? link.link_content
        : (link.original_transcript || link.link_content);
      // LOCKDOWN 2026-10-29: generate-voice requires a logged-in user
      // JWT (the public anon key is rejected by the function).
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ text: srcText, voice }),
      });
      if (!res.ok) throw new Error('فشل');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // Gendered slot (2026-10-28): generating one gender must never
      // clobber the other. Legacy synthetic_audio_url + voice_type can
      // only hold one voice, so they follow the female voice whenever
      // one exists (the historical default); a male voice mirrors
      // there only when no female voice exists yet.
      const legacyUrl = voice === 'female' ? data.audioUrl : (link.synthetic_audio_url_female ?? data.audioUrl);
      const legacyType = voice === 'female' ? 'female' : (link.synthetic_audio_url_female ? 'female' : 'male');
      const { error: saveError } = await supabase.from('ayah_links').update({
        synthetic_audio_url: legacyUrl,
        voice_type: legacyType,
        ...(voice === 'female'
          ? { synthetic_audio_url_female: data.audioUrl }
          : { synthetic_audio_url_male: data.audioUrl }),
      }).eq('id', link.id);
      if (saveError) throw saveError;
      setPendingLinks((prev) => prev.map((l) => (l.id === link.id ? {
        ...l,
        synthetic_audio_url: legacyUrl,
        voice_type: legacyType,
        ...(voice === 'female'
          ? { synthetic_audio_url_female: data.audioUrl }
          : { synthetic_audio_url_male: data.audioUrl }),
      } : l)));
    } catch {
      setAdminError('تعذّر توليد الصوت المخلّق — حاول تاني.');
    }
    setGeneratingVoiceId(null);
  };

  const exportExcel = () => {
    const headers = ['السورة', 'رقم السورة', 'رقم الآية', 'نص الآية', 'له تربيط', 'عدد التربيطات'];
    const rows = verses.map((v) => [v.surah_name, v.surah_no, v.ayah_no, v.ayah_text, v.has_links ? 'نعم' : 'لا', v.links_count]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'quran_verses_export.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // ADMINS ARE USERS TOO (2026-10-27): there is no separate admin
  // account anymore. Access is granted per user in admin_users
  // (16.12b: from the «الأدمن» tab through admin_grant/admin_revoke RPCs; was SQL only — no user can grant themselves, and the table has no
  // write policy for authenticated users). A logged-in admin uses
  // the normal app and reaches here from Settings; a normal user
  // never sees an admin entry and, even if they type #/admin,
  // gets this plain message instead of the admin UI.
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  // S5: a transient gate-check failure must offer retry, never a bare
  // "admin only" dead end to a real admin. maybeSingle() is the key:
  // a non-admin yields data=null with NO error, so any error here is
  // a genuine failure (network/permission), not "not an admin".
  const [gateError, setGateError] = useState(false);
  const [gateAttempt, setGateAttempt] = useState(0);
  useEffect(() => {
    if (!session?.user?.id) { setIsAdmin(false); return; }
    setGateError(false);
    supabase.from('admin_users').select('user_id').eq('user_id', session.user.id).maybeSingle()
      .then(({ data, error }) => {
        if (error) { setGateError(true); return; }
        setIsAdmin(!!data);
      });
  }, [session?.user?.id, gateAttempt]);
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-blue-50 px-4">
        <div className="bg-white rounded-2xl shadow-xl border border-hairline-emerald p-8 w-full max-w-md text-center">
          <h1 className="text-2xl md:text-3xl font-bold font-display-ar text-accent-800 mb-2">لوحة الإدارة</h1>
          <p className="text-sm text-accent-600 mb-5">سجل دخول بحسابك العادي أولاً — لو حسابك أدمن، الإدارة هتفتح لك من الإعدادات.</p>
          <button onClick={() => onNavigate('auth')} className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-xl">تسجيل الدخول</button>
          <button onClick={() => onNavigate('home')} className="w-full text-sm text-accent-600 hover:text-accent-700 py-3">العودة للرئيسية</button>
        </div>
      </div>
    );
  }
  if (isAdmin === null) {
    return <div className="min-h-screen flex items-center justify-center"><div className="w-10 h-10 border-4 border-hairline-emerald border-t-emerald-600 rounded-full animate-spin" /></div>;
  }
  if (gateError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-blue-50 px-4">
        <div className="bg-white rounded-2xl shadow-xl border border-hairline-emerald p-8 w-full max-w-md text-center">
          <h1 className="text-2xl md:text-3xl font-bold font-display-ar text-accent-800 mb-2">تعذّر التأكد من صلاحية الإدارة</h1>
          <p className="text-sm text-ink-2 mb-5">الاتصال بالخادم فشل أثناء التحقق — ده مش معناه إن حسابك مش أدمن. حاول تاني.</p>
          <button onClick={() => setGateAttempt((a) => a + 1)} className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-xl">إعادة المحاولة</button>
          <button onClick={() => onNavigate('app')} className="w-full text-sm text-ink-2 hover:text-accent-700 py-3">العودة للوحتي</button>
        </div>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-blue-50 px-4">
        <div className="bg-white rounded-2xl shadow-xl border border-hairline-emerald p-8 w-full max-w-md text-center">
          <h1 className="text-2xl md:text-3xl font-bold font-display-ar text-accent-800 mb-2">الصفحة دي للأدمن بس</h1>
          <p className="text-sm text-accent-600 mb-5">حسابك شغال كمستخدم عادي تماماً، وده مقصود — الإدارة مش بتظهر للمستخدم العادي.</p>
          <button onClick={() => onNavigate('app')} className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-xl">العودة للوحتي</button>
        </div>
      </div>
    );
  }

  // A pending row is a user suggestion only when its creator is positively a non-admin AND it carries no recording
  // (same rule as the old badge); everything else is admin work.
  const isUserSuggestion = (l: AyahLink) => !l.is_ai_draft && !!l.created_by && adminIds !== null && !adminIds.has(l.created_by) && !l.audio_url;
  // Three buckets, every pending row lands in exactly one: books > user suggestion > drafts (AI drafts + admin's own).
  // 6.19: the counts come from the server; the list holds the loaded pages of the current bucket.
  const bucketCount = bucketCounts ?? { drafts: 0, users: 0, books: 0 };
  const pendingList = pendingLinks;
  const BUCKETS = [
    { key: 'drafts' as const, title: 'مسودات للمراجعة', hint: 'مسودات الذكاء الاصطناعي وتسجيلاتك', Icon: PenLine, cls: 'from-violet-50 to-white border-violet-200 text-violet-800' },
    { key: 'users' as const, title: 'تربيطات مقترحة', hint: 'اقتراحات المستخدمين', Icon: Lightbulb, cls: 'from-teal-50 to-white border-teal-200 text-teal-800' },
    { key: 'books' as const, title: 'من كتب الأثر والتفسير', hint: 'تربيطات مأخوذة من الكتب', Icon: Library, cls: 'from-amber-50 to-white border-amber-300 text-amber-800' },
  ];
  const openBucket = (k: 'drafts' | 'users' | 'books') => { setPendingFilter(k); setShowPending(true); if (k !== pendingFilter || !pendingLoaded) { setPendingLinks([]); void fetchPendingLinks({ bucket: k }); } };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const linkedPercentage = Math.round((stats.withLinks / TOTAL_VERSES) * 100);
  const remaining = TOTAL_VERSES - stats.withLinks;

  const getLinkTypeColors = (types: string[]): string => {
    if (!types || types.length === 0) return 'bg-gray-100 text-ink-2';
    const first = types[0];
    const map: Record<string, string> = {
      wajih: 'bg-blue-100 text-blue-700', sifa: 'bg-cyan-100 text-cyan-700',
      mutashabihat: 'bg-teal-100 text-teal-700', sabab_nuzul: 'bg-orange-100 text-orange-700',
      fawaaid: 'bg-emerald-100 text-emerald-700', lafdhi: 'bg-pink-100 text-pink-700',
      adadi: 'bg-amber-100 text-amber-link', maqam: 'bg-indigo-100 text-indigo-700',
      takrir: 'bg-rose-100 text-rose-700',
    };
    return map[first] || 'bg-gray-100 text-ink-2';
  };

  const formatTypes = (types: string[]): string => {
    if (!types || types.length === 0) return '';
    return types.map((t) => LINK_TYPES.find((lt) => lt.value === t)?.label || t).join('، ');
  };

  return (
    <div className="min-h-screen page-bg">
      <header className="sticky top-0 z-40 app-header">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 bg-gradient-to-br from-emerald-500 to-teal-700 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-accent-800">تربيطات آيات القرآن</h1>
              <p className="text-xs text-accent-600">لوحة الإدارة — {session.user.email}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { setMergeMode((m) => !m); setMergeSel([]); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-smooth font-semibold border ${mergeMode ? 'bg-emerald-700 text-white border-emerald-600' : 'text-emerald-700 bg-emerald-50 border-hairline-emerald hover:bg-emerald-100'}`}>
              <Layers className="w-4 h-4" /> دمج آيات
            </button>
            <div className="relative">
              <button onClick={() => setMenuOpen((o) => !o)} aria-label="القائمة" aria-expanded={menuOpen}
                className="flex items-center justify-center w-10 h-10 text-accent-700 bg-white hover:bg-gray-50 border border-hairline rounded-xl">
                <Menu className="w-5 h-5" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute left-0 top-12 z-50 w-48 bg-white border border-hairline rounded-2xl shadow-xl p-1.5 text-sm font-semibold">
                    <button onClick={() => { setMenuOpen(false); onNavigate('mushaf'); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-right text-accent-700 hover:bg-gray-50 rounded-xl"><BookOpen className="w-4 h-4" /> المصحف</button>
                    <button onClick={() => { setMenuOpen(false); onNavigate('app'); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-right text-accent-700 hover:bg-gray-50 rounded-xl"><Users className="w-4 h-4" /> تطبيق المستخدم</button>
                    <button onClick={async () => { setMenuOpen(false); await signOut(); onNavigate('home'); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-right text-red-600 hover:bg-red-50 rounded-xl"><LogOut className="w-4 h-4" /> خروج</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {pendingError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-red-700 flex-1">{pendingError}</p>
            <button onClick={() => fetchPendingLinks()} className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg">إعادة تحميل القائمة</button>
          </div>
        )}
        {adminError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 mb-4 flex items-center gap-3">
            <p className="text-sm font-semibold text-red-700 flex-1">{adminError}</p>
            <button onClick={() => setAdminError('')} className="text-red-500 hover:bg-red-100 rounded p-1"><X className="w-4 h-4" /></button>
          </div>
        )}
        {/* 16.12: top tabs (same look as the stats tabs): review lists /
            verse table / statistics. Only one area shows at a time. */}
        <div role="tablist" aria-label="أقسام لوحة الإدارة" className="flex gap-1.5 mb-4 bg-white border border-hairline rounded-xl p-1 w-fit">
          {([['review', 'المراجعة'], ['verses', 'جدول الآيات'], ['stats', 'الإحصائيات'], ['admins', 'الأدمن']] as const).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={adminTab === key}
              onClick={() => { setAdminTab(key); if (key === 'stats' && !openPanel) setOpenPanel('progress'); try { sessionStorage.setItem('quran-admin-tab', key); } catch { /* ignore */ } }}
              className={`min-h-[44px] px-4 rounded-lg text-sm font-semibold ${adminTab === key ? 'bg-emerald-700 text-white' : 'text-accent-600 hover:bg-gray-100'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className={adminTab === 'review' ? '' : 'hidden'}>
        {/* Review: three clear lists */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {BUCKETS.map(({ key, title, hint, Icon, cls }) => (
            <button key={key} onClick={() => openBucket(key)}
              className={`flex items-center gap-3 text-right rounded-2xl border bg-gradient-to-br p-4 shadow-sm hover:shadow-md transition-smooth ${cls}`}>
              <span className="w-12 h-12 rounded-xl bg-white/80 border border-white flex items-center justify-center flex-shrink-0"><Icon className="w-6 h-6" /></span>
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-sm">{title}</span>
                <span className="block text-xs opacity-70">{hint}</span>
              </span>
              <span className="text-2xl font-extrabold tabular-nums">{formatAr(bucketCount[key])}</span>
            </button>
          ))}
        </div>

        </div>
        <div className={adminTab === 'stats' ? '' : 'hidden'}>
        {/* Stats: ONE button; its four panels are tabs inside */}
        <div className="mb-4">
          <button onClick={() => setOpenPanel((cur) => (cur ? null : 'progress'))}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-smooth ${openPanel ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-accent-700 border-hairline hover:bg-gray-50'}`}>
            <BarChart3 className="w-4 h-4" /> الإحصائيات {openPanel ? '▴' : '▾'}
          </button>
          {openPanel && (
            <div className="flex flex-wrap gap-1.5 mt-3 bg-white border border-hairline rounded-xl p-1 w-fit">
              {([
                ['progress', 'التقدم'],
                ['users', 'المستخدمين'],
                ['records', 'الأرقام'],
                ['openai', 'OpenAI'],
              ] as const).map(([key, label]) => (
                <button key={key} onClick={() => setOpenPanel(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${openPanel === key ? 'bg-emerald-700 text-white' : 'text-accent-600 hover:bg-gray-100'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dashboard — beautified */}
        <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 ${openPanel === 'progress' ? '' : 'hidden'}`}>
          <div className="bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 rounded-2xl p-6 flex items-center gap-6 shadow-lg relative overflow-hidden">
            <div className="absolute -top-6 -right-6 w-28 h-28 bg-white/10 rounded-full blur-2xl" />
            <div className="absolute -bottom-6 -left-6 w-24 h-24 bg-teal-300/10 rounded-full blur-xl" />
            <CircularProgressIndicator value={linkedPercentage} size={100} />
            <div className="flex-1 relative">
              <p className="text-sm text-emerald-100 font-semibold mb-1">تقدم إنشاء التربيطات</p>
              <p className="text-3xl font-bold text-white">{stats.withLinks.toLocaleString('ar-EG')}</p>
              <p className="text-xs text-emerald-200">من {TOTAL_VERSES.toLocaleString('ar-EG')} آية</p>
              <p className="text-xs text-amber-200 mt-1">{remaining.toLocaleString('ar-EG')} متبقية</p>
            </div>
          </div>
          <StatCard label="آيات لها تربيط" value={stats.withLinks} color="emerald" icon={<Bookmark className="w-5 h-5" />} />
          <StatCard label="آيات بدون تربيطات" value={stats.withoutLinks} color="red" icon={<X className="w-5 h-5" />} />
        </div>

        {/* User accounts — so the admins can rejoice in the good they
            provide (2026-10-28). Counted by the admin-only
            get_user_stats RPC; the button refreshes the count. */}
        <div className={`bg-gradient-to-br from-amber-500 via-amber-600 to-orange-600 rounded-2xl p-6 mb-4 shadow-lg relative overflow-hidden ${openPanel === 'users' ? '' : 'hidden'}`}>
          <div className="absolute -top-6 -left-6 w-28 h-28 bg-white/10 rounded-full blur-2xl" />
          <div className="flex flex-wrap items-center gap-6 relative">
            <div className="flex items-center justify-center w-16 h-16 bg-white/15 rounded-2xl shrink-0">
              <Users className="w-8 h-8 text-white" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <p className="text-sm text-amber-100 font-semibold mb-1">عدد حسابات المستخدمين</p>
              {userStats ? (
                <>
                  <p className="text-4xl font-bold text-white">{userStats.total.toLocaleString('ar-EG')} حساب</p>
                  <p className="text-xs text-amber-100 mt-1">منهم دخلوا فعلًا: {userStats.signed_in.toLocaleString('ar-EG')} • حسابات جديدة آخر ٣٠ يوم: {userStats.new_30d.toLocaleString('ar-EG')}</p>
                </>
              ) : userStatsError ? (
                <p className="text-sm font-medium text-white">{userStatsError}</p>
              ) : (
                <p className="text-sm text-amber-100">جارٍ التحميل…</p>
              )}
            </div>
            <button onClick={fetchUserStats} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-white/15 hover:bg-white/25 rounded-lg transition-smooth">
              <RefreshCw className="w-3.5 h-3.5" /> تحديث
            </button>
            <p className="text-sm font-semibold text-white bg-white/15 rounded-xl px-3 py-2">تقبّل الله منكم، ونتشارك الأجر كلنا</p>
          </div>
        </div>

        {/* OpenAI balance monitor — estimated from app-side usage logging */}
        {/* Numbers + records — admin only (this whole page is admin-only) */}
        <div className={`bg-white rounded-2xl border border-hairline p-5 mb-4 shadow-sm ${openPanel === 'records' ? '' : 'hidden'}`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-accent-800">الأرقام والسجلات</h3>
            <button onClick={() => { setRec(null); }} disabled={recLoading} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-lg disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${recLoading ? 'animate-spin' : ''}`} /> تحديث
            </button>
          </div>
          {!rec ? (
            <div className="py-6 text-center"><Loader2 className="w-6 h-6 mx-auto animate-spin text-emerald-500" /></div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {([
                ['عدد التربيطات', rec.links],
                ['آيات مربوطة', rec.versesLinked],
                ['صفحات مصحف مغطّاة', `${rec.pages} / 604`],
                ['تربيطات اليوم', rec.today],
                ['تربيطات مدموجة', rec.merged],
                ['تربيطات بعيدة', rec.far],
                ['أطول دمج (آيات)', rec.longestMerge],
                ['اقتراحات المستخدمين المعتمدة', rec.byUsers],
              ] as [string, number | string][]).map(([k, v]) => (
                <div key={k} className="bg-emerald-50/60 border border-hairline-emerald rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-emerald-800">{typeof v === 'number' ? v.toLocaleString('ar-EG') : v}</p>
                  <p className="text-[11px] text-accent-600 mt-0.5">{k}</p>
                </div>
              ))}
              {rec.bestDay && (
                <div className="col-span-2 sm:col-span-4 bg-amber-50 border border-hairline-amber rounded-xl p-3 text-center">
                  <p className="text-xs text-amber-800 font-semibold">رقم قياسي: أكتر يوم فيه تربيطات — {rec.bestDay.day} — <b>{rec.bestDay.n.toLocaleString('ar-EG')}</b> تربيط</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`bg-white rounded-2xl border border-hairline p-5 mb-4 shadow-sm ${openPanel === 'openai' ? '' : 'hidden'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-accent-800">رصيد OpenAI (تقديري)</p>
              <p className="text-xs text-accent-600 mt-0.5">من سجل استخدام التطبيق فقط — الرقم الدقيق في صفحة Usage على OpenAI</p>
            </div>
            {usage && (
              <button onClick={loadUsage} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-hairline-emerald transition-smooth">
                <RefreshCw className="w-3.5 h-3.5" /> تحديث
              </button>
            )}
          </div>
          {usage ? (
            <div className="mt-4">
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="text-xs text-accent-600 font-semibold">المتبقي التقديري</p>
                  <p className="text-2xl font-bold text-emerald-700">${Math.max(0, startingBalance - usage.total).toFixed(2)}</p>
                  <p className="text-xs text-accent-600">من ${startingBalance.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-accent-600 font-semibold">المصروف التقديري</p>
                  <p className="text-2xl font-bold text-accent-800">${usage.total.toFixed(4)}</p>
                  <p className="text-xs text-accent-600">عبر {usage.calls.toLocaleString('ar-EG')} مكالمة</p>
                </div>
              </div>
              {Math.max(0, startingBalance - usage.total) < 1 && (
                <div className="mt-3 px-3 py-2 bg-amber-50 border border-hairline-amber rounded-2xl text-xs font-semibold text-amber-800">
                  تنبيه: الرصيد المتبقي أقل من $1 — اشحن رصيد OpenAI قبل ما تتوقف خدمات الذكاء والصوت.
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                {Object.entries(usage.byFn).map(([fn, v]) => (
                  <span key={fn} className="px-2.5 py-1 bg-gray-50 border border-hairline rounded-lg text-xs text-accent-600">
                    {USAGE_LABELS[fn] || fn}: {v.calls.toLocaleString('ar-EG')} مكالمة — ${v.cost.toFixed(4)}
                  </span>
                ))}
              </div>
              {editingBalance ? (
                <div className="flex gap-2 mt-4">
                  <input value={balanceDraft} onChange={(e) => setBalanceDraft(e.target.value)} inputMode="decimal"
                    placeholder="5.00"
                    className="w-32 px-3 py-2 bg-gray-50 border border-hairline rounded-xl text-sm focus:outline-none focus:border-emerald-500" />
                  <button onClick={saveStartingBalance} className="px-3 py-2 bg-emerald-700 text-white text-sm font-semibold rounded-xl">حفظ</button>
                  <button onClick={() => setEditingBalance(false)} className="px-3 py-2 text-sm text-accent-600">إلغاء</button>
                </div>
              ) : (
                <button onClick={() => { setBalanceDraft(String(startingBalance)); setUsageError(''); setEditingBalance(true); }}
                  className="mt-4 text-xs text-accent-600 underline underline-offset-2 hover:text-accent-700">
                  تعديل الرصيد الابتدائي (لو شحنت رصيد جديد)
                </button>
              )}
              {usageError && <p className="text-xs text-red-500 mt-2">{usageError}</p>}
            </div>
          ) : (
            <p className="text-sm text-accent-600 mt-3">لا توجد بيانات استخدام بعد — تبدأ مع أول استخدام للذكاء بعد التحديث.</p>
          )}
        </div>

        </div>
        {adminTab === 'admins' && <AdminsPanel selfId={session?.user?.id ?? null} />}
        <div className={adminTab === 'verses' ? '' : 'hidden'}>
        {/* Toolbar — beautified */}
        <div className="bg-white rounded-2xl border border-hairline p-4 mb-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
              <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                placeholder="بحث بالنص، رقم، أو سورة:آية (مثل 2:255)..."
                className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-hairline rounded-xl text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-smooth" />
            </div>
            {searchHint && (
              <div className="flex items-center gap-1.5 text-xs text-amber-link bg-amber-50 px-3 py-1.5 rounded-lg border border-hairline-amber">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {searchHint}
              </div>
            )}
            <div className="min-w-[10rem]"><DrumSelect label="السورة" value={surahFilter} onChange={(v) => { setSurahFilter(String(v)); setPage(0); }}
              options={[{ value: '', label: 'كل السور' }, ...SURAHS.map((x) => ({ value: String(x.no), label: `${x.no}. ${x.name}` }))]} /></div>
            <div className="flex items-center gap-1 bg-gray-50 rounded-xl p-1 border border-hairline">
              {(['all', 'green', 'red'] as VerseFilter[]).map((f) => (
                <button key={f} onClick={() => { setStatusFilter(f); setPage(0); }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-smooth ${
                    statusFilter === f
                      ? f === 'green' ? 'bg-emerald-500 text-white shadow-sm' : f === 'red' ? 'bg-red-600 text-white shadow-sm' : 'bg-accent-700 text-white shadow-sm'
                      : 'text-ink-2 hover:bg-gray-100'
                  }`}>
                  {f === 'all' ? 'الكل' : f === 'green' ? 'له تربيط' : 'بدون تربيط'}
                </button>
              ))}
            </div>
            <button onClick={exportExcel} aria-label="تصدير إلى إكسل" title="تصدير إلى إكسل" className="flex items-center justify-center w-11 h-11 text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-smooth">
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Verse table — beautified */}
        <div className="bg-white rounded-2xl border border-hairline shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <div className="w-10 h-10 border-4 border-hairline-emerald border-t-emerald-600 rounded-full animate-spin" />
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {verses.map((verse) => {
                const bgClass = verse.has_links
                  ? 'bg-gradient-to-l from-emerald-50/60 to-transparent border-r-4 border-emerald-400'
                  : 'bg-gradient-to-l from-red-50/40 to-transparent border-r-4 border-red-400';
                const isRanaTarget = firstUnlinkedId === verse.id && showRanaArrow;
                return (
                  <div key={verse.id} className={`p-4 ${bgClass} ${isRanaTarget ? 'ring-2 ring-amber-400 ring-offset-1' : ''} hover:shadow-sm transition-smooth animate-fade-in relative`}>
                    {isRanaTarget && (
                      <div className="absolute -top-2 right-4 z-20 flex items-center gap-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white px-3 py-1.5 rounded-lg shadow-lg animate-bounce-slow">
                        <span className="text-xs font-semibold whitespace-nowrap">سجلي من هنا</span>
                        <svg className="w-5 h-5 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                        <button onClick={(e) => { e.stopPropagation(); setShowRanaArrow(false); }} className="mr-1 hover:bg-white/20 rounded p-0.5">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          {mergeMode && (
                            <input type="checkbox" aria-label={`اختيار الآية ${verse.ayah_no} للدمج`} checked={mergeSel.some((x) => x.id === verse.id)}
                              onChange={() => setMergeSel((cur) => cur.some((x) => x.id === verse.id) ? cur.filter((x) => x.id !== verse.id) : [...cur, verse])}
                              className="w-6 h-6 accent-emerald-600" />
                          )}
                          <span className="flex flex-col items-center justify-center min-w-[3.25rem] px-2 py-1 bg-emerald-700 text-white rounded-xl leading-none shadow-sm">
                            <span className="text-[10px] opacity-80">آية</span>
                            <span className="text-2xl font-extrabold">{verse.ayah_no.toLocaleString('ar-EG')}</span>
                          </span>
                          <span className="text-sm font-semibold text-accent-700">{verse.surah_name}</span>
                          <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${verse.links_count > 0 ? 'text-emerald-700 bg-emerald-50' : 'text-ink-3 bg-gray-50'}`}>
                            <Bookmark className="w-3 h-3" /> {verse.links_count > 0 ? `${verse.links_count} تربيط` : 'بدون تربيط'}
                          </span>
                        </div>
                        <p className="font-arabic text-lg text-accent-800 leading-loose line-clamp-2">{blankMarks(verse.ayah_text)}</p>

                        {showLinksFor === verse.id && verseLinks.length > 0 && (
                          <div className="mt-3 space-y-1.5 animate-slide-up">
                            {verseLinks.map((link) => (
                              <div key={link.id} className="flex items-start gap-2 text-xs bg-white/80 rounded-2xl p-2.5 border border-hairline">
                                <span className={`px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${getLinkTypeColors(link.link_types)}`}>
                                  {formatTypes(link.link_types)}
                                </span>
                                <div className="flex-1 min-w-0">
                                  {link.link_title && <p className="font-semibold text-accent-700 mb-0.5">{link.link_title}</p>}
                                  <p className="text-accent-600 leading-relaxed">{link.link_content}</p>
                                  {link.audio_url && (
                                    <div className="flex items-center gap-1 mt-1">
                                      <Volume2 className="w-3 h-3 text-emerald-600" />
                                      <a href={link.audio_url} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline text-xs">مقطع رنا</a>
                                    </div>
                                  )}
                                  {link.status === 'pending' && <span className="text-xs text-amber-link font-semibold">بانتظار المراجعة</span>}
                                </div>
                                <button onClick={() => deleteLink(link.id)} disabled={!!savingIds[link.id]} aria-label="حذف التربيط" className="icon-action text-red-500 hover:bg-red-100 rounded p-1 flex-shrink-0 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* One clear action + two quiet text links */}
                      <div className="flex flex-col items-stretch gap-1.5 flex-shrink-0 w-32">
                        <button onClick={() => setLinkModalVerse(verse)}
                          className="flex items-center justify-center gap-2 px-3 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow font-semibold text-sm">
                          <Mic className="w-5 h-5" /> سجّلي تربيط
                        </button>
                        {verse.links_count > 0 && (
                          <button onClick={() => { if (showLinksFor === verse.id) { setShowLinksFor(null); } else { setShowLinksFor(verse.id); fetchVerseLinks(verse.id); } }}
                            className={`px-2 py-1.5 text-xs font-semibold rounded-lg ${showLinksFor === verse.id ? 'bg-emerald-700 text-white' : 'text-emerald-700 hover:bg-emerald-50'}`}>
                            التربيطات ({verse.links_count})
                          </button>
                        )}
                        <button onClick={() => setFarFrom(verse)} className="px-2 py-1.5 text-xs font-semibold rounded-lg text-amber-800 hover:bg-amber-50">
                          ربط ببعيدة
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {verses.length === 0 && !loading && (
                <div className="py-20 text-center text-accent-400">
                  <Filter className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>لا توجد نتائج مطابقة</p>
                </div>
              )}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-hairline bg-gray-50">
              <p className="text-xs text-accent-600">صفحة {formatAr(page + 1)} من {formatAr(totalPages)} — {formatAr(totalCount)} آية</p>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} aria-label="الصفحة السابقة" className="icon-action p-2 text-accent-600 hover:bg-white rounded-lg disabled:opacity-30 transition-smooth"><ChevronRight className="w-4 h-4" /></button>
                <span className="text-xs text-accent-600 px-2">{formatAr(page + 1)}</span>
                <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} aria-label="الصفحة التالية" className="icon-action p-2 text-accent-600 hover:bg-white rounded-lg disabled:opacity-30 transition-smooth"><ChevronLeft className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Pending Links Review Modal */}
      {showPending && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto" onClick={() => setShowPending(false)}>
          <div role="dialog" aria-modal="true" aria-label="تربيطات بانتظار المراجعة" className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl my-8 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-hairline sticky top-0 bg-white rounded-t-3xl z-10">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-600" />
                <h3 className="font-semibold text-accent-800">{BUCKETS.find((b) => b.key === pendingFilter)?.title} ({formatAr(bucketCount[pendingFilter])})</h3>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => fetchPendingLinks()} disabled={pendingLoading}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${pendingLoading ? 'animate-spin' : ''}`} /> تحديث القائمة
                </button>
                <button onClick={() => setShowPending(false)} aria-label="إغلاق" className="icon-action p-1.5 text-ink-3 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              {pendingError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold text-red-700 flex-1">{pendingError}</p>
                  <button onClick={() => fetchPendingLinks()} className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg">إعادة المحاولة</button>
                </div>
              )}
              {adminError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 flex items-center gap-2">
                  <p className="text-xs font-semibold text-red-700 flex-1">{adminError}</p>
                  <button onClick={() => setAdminError('')} className="text-red-500 hover:bg-red-100 rounded p-1"><X className="w-4 h-4" /></button>
                </div>
              )}
              {(
                <div className="flex flex-wrap gap-1.5">
                  {(BUCKETS.map((b) => [b.key, `${b.title} (${bucketCount[b.key]})`] as const)).map(([k, label]) => (
                    <button key={k} onClick={() => { if (k === pendingFilter) return; setPendingFilter(k); setPendingLinks([]); void fetchPendingLinks({ bucket: k }); }}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border ${pendingFilter === k ? (k === 'users' ? 'bg-teal-600 text-white border-teal-600' : 'bg-emerald-700 text-white border-emerald-700') : 'bg-white text-accent-700 border-hairline'}`}>{label}</button>
                  ))}
                </div>
              )}
              {pendingList.length === 0 ? (
                pendingLoading || !pendingLoaded ? (
                  <div className="text-center py-12 text-accent-400">
                    <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-emerald-500" />
                    <p>جارٍ تحميل قائمة المراجعة…</p>
                  </div>
                ) : (
                <div className="text-center py-12 text-accent-400">
                  <Check className="w-10 h-10 mx-auto mb-2 text-emerald-400" />
                  <p>{pendingFilter === 'books' ? 'لسه مفيش تربيطات من كتب الأثر والتفسير' : 'لا توجد تربيطات بانتظار المراجعة هنا'}</p>
                </div>
                )
              ) : (
                <>
                  {pendingList.map((link) => {
                  const verse = pendingVerses[link.verse_id];
                  const fromUser = isUserSuggestion(link);
                  return (
                    <div key={link.id} className={`rounded-xl p-4 border-2 ${fromUser ? 'bg-teal-50/70 border-teal-300' : 'bg-gray-50 border-hairline'}`}>
                      {fromUser && link.created_by && (
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-teal-800"><User className="w-3.5 h-3.5" /> من المستخدم: {authors[link.created_by] || '…'}</div>
                      )}
                      {link.group_verse_ids && link.group_verse_ids.length > 1 && (
                        <div className="mb-2 text-xs font-bold text-emerald-800 bg-emerald-50 rounded-lg px-2 py-1">تربيط مدموج: {link.group_verse_ids.length} آيات متتالية</div>
                      )}
                      {link.related_verse_id && (
                        <div className="mb-2 text-xs font-bold text-amber-800 bg-amber-50 rounded-lg px-2 py-1">تربيط ببعيدة (آية رقم داخلي {link.related_verse_id})</div>
                      )}
                      {verse && (
                        <div className="mb-2 text-xs text-accent-600">
                          {verse.surah_name} — آية {verse.ayah_no}: <span className="font-arabic text-accent-600">{blankMarks(verse.ayah_text ?? '').slice(0, 80)}...</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">{formatTypes(link.link_types)}</span>
                        {link.source === 'books' && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">من الكتب</span>}
                        {link.is_ai_draft && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">مسودة ذكاء اصطناعي</span>}
                        {/* S5 (V10): "اقتراح مستخدم" ONLY when the creator is
                            positively known to be a non-admin AND the row
                            carries no original recording (the user suggest
                            form is text-only; admin recordings always carry
                            audio_url). is_ai_draft alone proves nothing —
                            it defaults to false for admin rows too. When
                            adminIds is still null (load failed), no badge
                            is shown rather than a possibly wrong one. */}
                        {!link.is_ai_draft && link.created_by && adminIds !== null && !adminIds.has(link.created_by) && !link.audio_url && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-700">اقتراح مستخدم</span>}
                        {link.audio_url && (
                          <a href={link.audio_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-emerald-700 hover:underline">
                            <Volume2 className="w-3 h-3" /> مقطع رنا الأصلي
                          </a>
                        )}
                      </div>

                      {editingLinkId === link.id ? (
                        <div className="mb-2">
                          <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3}
                            className="w-full px-3 py-2 bg-white border border-hairline-input rounded-xl text-sm focus:outline-none focus:border-emerald-500 resize-none" />
                          <div className="flex gap-2 mt-1">
                            <button onClick={() => saveEditText(link.id)} disabled={!!savingIds[link.id]} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50">
                              <Check className="w-3 h-3" /> {savingIds[link.id] ? 'جارٍ الحفظ…' : 'حفظ النص'}
                            </button>
                            <button onClick={() => setEditingLinkId(null)} className="px-3 py-1.5 text-accent-600 text-xs hover:bg-gray-100 rounded-lg">إلغاء</button>
                          </div>
                        </div>
                      ) : (
                        <div className="mb-2">
                          {link.link_title && <p className="text-sm font-semibold text-accent-700 mb-1">{link.link_title}</p>}
                          <p className="text-sm text-accent-600 leading-relaxed">{link.link_content}</p>
                          <button onClick={() => startEditText(link)} className="text-xs text-blue-600 hover:underline mt-1">تعديل النص مباشرة</button>
                        </div>
                      )}

                      {link.original_transcript && (
                        <details className="mt-2 mb-2">
                          <summary className="text-xs text-accent-600 cursor-pointer hover:text-accent-600">النص الأصلي المنطوق</summary>
                          <p className="text-xs text-accent-600 mt-1 p-2 bg-white rounded">{link.original_transcript}</p>
                        </details>
                      )}

                      {/* Original voice FIRST (2026-10-28): an admin's
                          first listen is the original recording, inline
                          — the synthetic box below is only after it. */}
                      {link.audio_url && (
                        <div className="bg-emerald-50 rounded-2xl p-3 border border-hairline-emerald mt-2">
                          <p className="text-xs font-semibold text-emerald-700 mb-2">الصوت الأصلي</p>
                          <button onClick={() => new Audio(link.audio_url!).play()}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg">
                            <Volume2 className="w-3.5 h-3.5" /> تشغيل الصوت الأصلي
                          </button>
                        </div>
                      )}

                      <div className="bg-blue-50 rounded-2xl p-3 border border-blue-100 mt-2">
                        <p className="text-xs font-semibold text-blue-700 mb-2">الصوت المخلّق للمستخدم</p>
                        {(link.synthetic_audio_url_female || link.synthetic_audio_url_male || link.synthetic_audio_url) ? (
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            {link.synthetic_audio_url_female && (
                              <button onClick={() => new Audio(link.synthetic_audio_url_female!).play()}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg">
                                <Volume2 className="w-3.5 h-3.5" /> تشغيل (نسائي)
                              </button>
                            )}
                            {link.synthetic_audio_url_male && (
                              <button onClick={() => new Audio(link.synthetic_audio_url_male!).play()}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg">
                                <Volume2 className="w-3.5 h-3.5" /> تشغيل (رجالي)
                              </button>
                            )}
                            {!link.synthetic_audio_url_female && !link.synthetic_audio_url_male && link.synthetic_audio_url && (
                              <button onClick={() => new Audio(link.synthetic_audio_url!).play()}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg">
                                <Volume2 className="w-3.5 h-3.5" /> تشغيل ({link.voice_type === 'female' ? 'نسائي' : 'رجالي'})
                              </button>
                            )}
                            <span className="text-xs text-blue-500">جاهز للنشر</span>
                          </div>
                        ) : (
                          <p className="text-xs text-blue-400 mb-2">لم يتم توليد الصوت بعد</p>
                        )}
                        <div className="flex gap-1.5">
                          <button onClick={() => generateVoiceForLink(link, 'male')} disabled={generatingVoiceId === link.id}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-blue-200 text-blue-700 text-xs font-semibold rounded-lg hover:bg-blue-50 disabled:opacity-50">
                            {generatingVoiceId === link.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <User className="w-3 h-3" />}
                            {link.synthetic_audio_url_male ? 'إعادة' : 'صوت رجالي'}
                          </button>
                          <button onClick={() => generateVoiceForLink(link, 'female')} disabled={generatingVoiceId === link.id}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-pink-200 text-pink-700 text-xs font-semibold rounded-lg hover:bg-pink-50 disabled:opacity-50">
                            {generatingVoiceId === link.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Heart className="w-3 h-3" />}
                            {link.synthetic_audio_url_female ? 'إعادة' : 'صوت نسائي'}
                          </button>
                        </div>
                      </div>

                      <div className="flex gap-2 mt-3">
                        <input type="text" value={rephraseCmds[link.id] || ''} onChange={(e) => setRephraseCmds((prev) => ({ ...prev, [link.id]: e.target.value }))}
                          placeholder="طلب تعديل (اختياري): مثلاً — اجعله أقصر"
                          className="flex-1 px-2.5 py-1.5 bg-white border border-hairline rounded-xl text-xs focus:outline-none focus:border-emerald-500" />
                        <button onClick={() => rephrasePending(link)} disabled={rephrasingId === link.id}
                          className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50">
                          <RefreshCw className="w-3 h-3" /> {rephrasingId === link.id ? '...' : 'صياغة'}
                        </button>
                      </div>

                      {proposals[link.id] && (
                        <div className="bg-violet-50 rounded-2xl p-3 border border-violet-200 mt-3">
                          <p className="text-xs font-semibold text-violet-700 mb-1">صياغة مقترحة بالذكاء الاصطناعي{proposals[link.id].command ? ` (طلب: ${proposals[link.id].command})` : ''}</p>
                          <p className="text-sm text-accent-700 leading-relaxed mb-2">{proposals[link.id].text}</p>
                          <div className="flex gap-2">
                            <button onClick={() => applyProposal(link.id)} disabled={!!savingIds[link.id]} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg disabled:opacity-50">{savingIds[link.id] ? 'جارٍ الحفظ…' : 'اعتمديه'}</button>
                            <button onClick={() => discardProposal(link.id)} className="px-3 py-1.5 text-accent-600 text-xs hover:bg-gray-100 rounded-lg">تجاهليه</button>
                          </div>
                          <p className="text-xs text-accent-600 mt-1.5">النص الأصلي محفوظ زي ما هو لحد ما تعتمدي — اطلبي تعديل تاني من الحقل اللي فوق وكرري لحد ما ترضي، وبعدين اعتمدي.</p>
                        </div>
                      )}
                                            <div className="flex gap-2 mt-3">
                        <button onClick={() => approveLink(link.id)} disabled={!!savingIds[link.id]}
                          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-lg transition-smooth disabled:opacity-50">
                          <Check className="w-4 h-4" /> {savingIds[link.id] ? 'جارٍ النشر…' : 'اقبلي وانشري'}
                        </button>
                        <button onClick={() => rejectLink(link.id)} disabled={!!savingIds[link.id]}
                          className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-smooth disabled:opacity-50">
                          <X className="w-4 h-4" /> {savingIds[link.id] ? 'جارٍ الرفض…' : 'ارفضيه'}
                        </button>
                      </div>
                    </div>
                  );
                  })}
                  {pendingHasMore && (
                  <button onClick={() => void fetchPendingLinks({ append: true })} disabled={pendingLoading}
                    className="w-full py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-link text-sm font-semibold rounded-xl border border-hairline-amber">
                    {pendingLoading ? 'جارٍ التحميل…' : `عرض المزيد (${formatAr(Math.max(0, bucketCount[pendingFilter] - pendingList.length))} متبقية)`}
                  </button>
                )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {linkModalVerse && (
        <LinkModal verse={linkModalVerse} groupVerses={linkModalGroup} relatedVerse={linkModalRelated}
          onClose={() => { setLinkModalVerse(null); setLinkModalGroup(undefined); setLinkModalRelated(null); }}
          onSaved={() => { setLinkModalVerse(null); setLinkModalGroup(undefined); setLinkModalRelated(null); setMergeSel([]); setMergeMode(false); setRec(null); fetchVerses(); fetchStats(); fetchPendingLinks(); }} />
      )}
      {farFrom && (
        <FarLinkPicker from={farFrom} onClose={() => setFarFrom(null)}
          onPick={(other) => { setLinkModalRelated(other); setLinkModalGroup(undefined); setLinkModalVerse(farFrom); setFarFrom(null); }} />
      )}
      {mergeMode && (() => {
        const sel = [...mergeSel].sort((a, b) => a.id - b.id);
        const sameSurah = sel.every((v) => v.surah_no === sel[0]?.surah_no);
        const consecutive = sel.every((v, i) => i === 0 || v.id === sel[i - 1].id + 1);
        const ok = sel.length >= 2 && sameSurah && consecutive;
        return (
          <div dir="rtl" className="fixed bottom-0 inset-x-0 z-40 bg-white border-t-2 border-emerald-500 shadow-2xl p-3 flex flex-wrap items-center gap-2 justify-between">
            <div className="text-xs min-w-0">
              <b className="text-emerald-800">دمج آيات في تربيط واحد</b>
              <p className="text-accent-600">
                {sel.length === 0 ? 'علّم على الآيات المتتالية (أي عدد) من نفس السورة' :
                  `المختار: ${sel.map((v) => v.ayah_no).join('، ')}${!sameSurah ? ' — لازم من نفس السورة' : !consecutive ? ' — لازم متتالية بدون فراغ' : sel.length < 2 ? ' — اختار آيتين على الأقل' : ''}`}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setMergeMode(false); setMergeSel([]); }} className="px-3 py-2 rounded-xl text-sm font-semibold bg-gray-100 text-accent-700">إلغاء</button>
              <button disabled={!ok} onClick={() => { setLinkModalGroup(sel); setLinkModalRelated(null); setLinkModalVerse(sel[0]); }}
                className="px-4 py-2 rounded-xl text-sm font-bold bg-emerald-700 text-white disabled:opacity-40">سجّل التربيط ({sel.length})</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
