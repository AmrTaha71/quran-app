import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { loadVerseIndex, searchVerseIds } from '../lib/searchIndex';
import { signOut } from '../lib/auth';
import type { Session } from '@supabase/supabase-js';
import type { QuranVerse, VerseFilter, AyahLink } from '../lib/types';
import { TOTAL_VERSES, LINK_TYPES } from '../lib/types';
import { SURAHS } from '../lib/surahs';
import {
  BookOpen, LogOut, Search, Bookmark, Settings, Trash2,
  ChevronRight, ChevronLeft, Download, Filter, X,
  Check, RefreshCw, Volume2, Clock, AlertCircle, AudioLines, User, Heart, Loader2, Mic,
} from 'lucide-react';
import AdminLogin from './AdminLogin';
import CircularProgressIndicator from '../components/CircularProgressIndicator';
import LinkModal from '../components/LinkModal';

type Route = 'home' | 'admin' | 'app' | 'auth' | 'mushaf' | 'follow';

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
  const [startingBalance, setStartingBalance] = useState(5);
  const [balanceDraft, setBalanceDraft] = useState('5');
  const [editingBalance, setEditingBalance] = useState(false);
  const [usageError, setUsageError] = useState('');
  const [linkModalVerse, setLinkModalVerse] = useState<QuranVerse | null>(null);
  const [verseLinks, setVerseLinks] = useState<AyahLink[]>([]);
  const [showLinksFor, setShowLinksFor] = useState<number | null>(null);

  const [pendingLinks, setPendingLinks] = useState<AyahLink[]>([]);
  const [pendingVerses, setPendingVerses] = useState<Record<number, QuranVerse>>({});
  const [showPending, setShowPending] = useState(false);
  // Pending queue pagination: the queue renders cards with inputs and
  // voice buttons, so showing hundreds at once would freeze the page.
  // Rana sees 50 at a time and loads more on demand.
  const [pendingVisible, setPendingVisible] = useState(50);
  const [rephrasingId, setRephrasingId] = useState<number | null>(null);
  const [rephraseCmd, setRephraseCmd] = useState('');
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

  const fetchPendingLinks = useCallback(async () => {
    const { data } = await supabase
      .from('ayah_links')
      .select(`*, quran_verses!inner(id, surah_no, surah_name, ayah_no, ayah_text)`)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (data) {
      setPendingLinks(data as unknown as AyahLink[]);
      const verseMap: Record<number, QuranVerse> = {};
      (data as any[]).forEach((d) => {
        const v = d.quran_verses;
        if (v) verseMap[d.verse_id] = v;
      });
      setPendingVerses(verseMap);
    }
  }, []);

  useEffect(() => { fetchVerses(); }, [fetchVerses]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchPendingLinks(); }, [fetchPendingLinks]);
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

  const deleteLink = async (linkId: number) => {
    await supabase.from('ayah_links').delete().eq('id', linkId);
    if (showLinksFor) fetchVerseLinks(showLinksFor);
    fetchVerses();
  };

  const approveLink = async (linkId: number) => {
    await supabase.from('ayah_links').update({ status: 'approved' }).eq('id', linkId);
    fetchPendingLinks(); fetchStats(); fetchVerses();
  };

  const rejectLink = async (linkId: number) => {
    await supabase.from('ayah_links').update({ status: 'rejected' }).eq('id', linkId);
    fetchPendingLinks();
  };

  const rephrasePending = async (link: AyahLink) => {
    setRephrasingId(link.id);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/smart-rephrase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ text: link.link_content, command: rephraseCmd || undefined, mode: 'rephrase' }),
      });
      if (!res.ok) throw new Error('فشل');
      const data = await res.json();
      const newText = data.rephrased || link.link_content;
      // Proposal only: the admin approves it, discards it, or asks
      // for another version. The stored text is untouched until approval.
      setProposals((prev) => ({ ...prev, [link.id]: { text: newText, command: rephraseCmd || '' } }));
      setRephraseCmd('');
    } catch {
      alert('تعذر إعادة الصياغة');
    }
    setRephrasingId(null);
  };

  // Approve a proposed AI version: only now is it written to the DB.
  const applyProposal = async (linkId: number) => {
    const proposal = proposals[linkId];
    if (!proposal) return;
    await supabase.from('ayah_links').update({ link_content: proposal.text, rephrase_command: proposal.command || null }).eq('id', linkId);
    setProposals((prev) => { const next = { ...prev }; delete next[linkId]; return next; });
    fetchPendingLinks();
  };

  const discardProposal = (linkId: number) => {
    setProposals((prev) => { const next = { ...prev }; delete next[linkId]; return next; });
  };

  const startEditText = (link: AyahLink) => { setEditingLinkId(link.id); setEditText(link.link_content); };

  const saveEditText = async (linkId: number) => {
    await supabase.from('ayah_links').update({ link_content: editText.trim() }).eq('id', linkId);
    setEditingLinkId(null);
    fetchPendingLinks();
  };

  const generateVoiceForLink = async (link: AyahLink, voice: 'male' | 'female') => {
    setGeneratingVoiceId(link.id);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ text: link.link_content, voice }),
      });
      if (!res.ok) throw new Error('فشل');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await supabase.from('ayah_links').update({ synthetic_audio_url: data.audioUrl, voice_type: voice }).eq('id', link.id);
      fetchPendingLinks();
    } catch {
      alert('تعذر توليد الصوت المخلّق');
    }
    setGeneratingVoiceId(null);
  };

  const exportExcel = () => {
    const headers = ['السورة', 'رقم السورة', 'رقم الآية', 'نص الآية', 'له رابط', 'عدد الروابط'];
    const rows = verses.map((v) => [v.surah_name, v.surah_no, v.ayah_no, v.ayah_text, v.has_links ? 'نعم' : 'لا', v.links_count]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'quran_verses_export.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  if (!session) return <AdminLogin onNavigate={onNavigate} />;

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const linkedPercentage = Math.round((stats.withLinks / TOTAL_VERSES) * 100);
  const remaining = TOTAL_VERSES - stats.withLinks;

  const getLinkTypeColors = (types: string[]): string => {
    if (!types || types.length === 0) return 'bg-gray-100 text-gray-700';
    const first = types[0];
    const map: Record<string, string> = {
      wajih: 'bg-blue-100 text-blue-700', sifa: 'bg-cyan-100 text-cyan-700',
      mutashabihat: 'bg-teal-100 text-teal-700', sabab_nuzul: 'bg-orange-100 text-orange-700',
      fawaaid: 'bg-emerald-100 text-emerald-700', lafdhi: 'bg-pink-100 text-pink-700',
      adadi: 'bg-amber-100 text-amber-700', maqam: 'bg-indigo-100 text-indigo-700',
      takrir: 'bg-rose-100 text-rose-700',
    };
    return map[first] || 'bg-gray-100 text-gray-700';
  };

  const formatTypes = (types: string[]): string => {
    if (!types || types.length === 0) return '';
    return types.map((t) => LINK_TYPES.find((lt) => lt.value === t)?.label || t).join('، ');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-gray-50 to-gray-50">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-emerald-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-gradient-to-br from-emerald-500 to-teal-700 rounded-xl flex items-center justify-center shadow-lg">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-accent-800">روابط الذكر الحكيم</h1>
              <p className="text-xs text-accent-500">لوحة الإدارة — {session.user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pendingLinks.length > 0 && (
              <button onClick={() => { setPendingVisible(50); setShowPending(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-smooth font-semibold border border-amber-200">
                <Clock className="w-4 h-4" /> مراجعة ({pendingLinks.length})
              </button>
            )}
            <button onClick={() => onNavigate('mushaf')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 rounded-lg transition-smooth font-semibold">
              <BookOpen className="w-4 h-4" /> المصحف
            </button>
            <button onClick={() => onNavigate('app')} className="px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50 rounded-lg transition-smooth font-semibold">تطبيق المستخدم</button>
            <button onClick={async () => { await signOut(); onNavigate('home'); }} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-smooth font-semibold">
              <LogOut className="w-4 h-4" /> خروج
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Dashboard — beautified */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 rounded-2xl p-6 flex items-center gap-6 shadow-lg relative overflow-hidden">
            <div className="absolute -top-6 -right-6 w-28 h-28 bg-white/10 rounded-full blur-2xl" />
            <div className="absolute -bottom-6 -left-6 w-24 h-24 bg-teal-300/10 rounded-full blur-xl" />
            <CircularProgressIndicator value={linkedPercentage} size={100} />
            <div className="flex-1 relative">
              <p className="text-sm text-emerald-100 font-semibold mb-1">تقدم إنشاء الروابط</p>
              <p className="text-3xl font-bold text-white">{stats.withLinks.toLocaleString('ar-EG')}</p>
              <p className="text-xs text-emerald-200">من {TOTAL_VERSES.toLocaleString('ar-EG')} آية</p>
              <p className="text-xs text-amber-200 mt-1">{remaining.toLocaleString('ar-EG')} متبقية</p>
            </div>
          </div>
          <StatCard label="آيات لها رابط" value={stats.withLinks} color="emerald" icon={<Bookmark className="w-5 h-5" />} />
          <StatCard label="آيات بدون روابط" value={stats.withoutLinks} color="red" icon={<X className="w-5 h-5" />} />
        </div>

        {/* OpenAI balance monitor — estimated from app-side usage logging */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-accent-800">رصيد OpenAI (تقديري)</p>
              <p className="text-xs text-accent-500 mt-0.5">من سجل استخدام التطبيق فقط — الرقم الدقيق في صفحة Usage على OpenAI</p>
            </div>
            {usage && (
              <button onClick={loadUsage} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-smooth">
                <RefreshCw className="w-3.5 h-3.5" /> تحديث
              </button>
            )}
          </div>
          {usage ? (
            <div className="mt-4">
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="text-xs text-accent-500 font-semibold">المتبقي التقديري</p>
                  <p className="text-2xl font-bold text-emerald-700">${Math.max(0, startingBalance - usage.total).toFixed(2)}</p>
                  <p className="text-xs text-accent-400">من ${startingBalance.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-accent-500 font-semibold">المصروف التقديري</p>
                  <p className="text-2xl font-bold text-accent-800">${usage.total.toFixed(4)}</p>
                  <p className="text-xs text-accent-400">عبر {usage.calls.toLocaleString('ar-EG')} مكالمة</p>
                </div>
              </div>
              {Math.max(0, startingBalance - usage.total) < 1 && (
                <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg text-xs font-semibold text-amber-800">
                  تنبيه: الرصيد المتبقي أقل من $1 — اشحن رصيد OpenAI قبل ما تتوقف خدمات الذكاء والصوت.
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                {Object.entries(usage.byFn).map(([fn, v]) => (
                  <span key={fn} className="px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs text-accent-600">
                    {USAGE_LABELS[fn] || fn}: {v.calls.toLocaleString('ar-EG')} مكالمة — ${v.cost.toFixed(4)}
                  </span>
                ))}
              </div>
              {editingBalance ? (
                <div className="flex gap-2 mt-4">
                  <input value={balanceDraft} onChange={(e) => setBalanceDraft(e.target.value)} inputMode="decimal"
                    placeholder="5.00"
                    className="w-32 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500" />
                  <button onClick={saveStartingBalance} className="px-3 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl">حفظ</button>
                  <button onClick={() => setEditingBalance(false)} className="px-3 py-2 text-sm text-accent-500">إلغاء</button>
                </div>
              ) : (
                <button onClick={() => { setBalanceDraft(String(startingBalance)); setUsageError(''); setEditingBalance(true); }}
                  className="mt-4 text-xs text-accent-500 underline underline-offset-2 hover:text-accent-700">
                  تعديل الرصيد الابتدائي (لو شحنت رصيد جديد)
                </button>
              )}
              {usageError && <p className="text-xs text-red-500 mt-2">{usageError}</p>}
            </div>
          ) : (
            <p className="text-sm text-accent-500 mt-3">لا توجد بيانات استخدام بعد — تبدأ مع أول استخدام للذكاء بعد التحديث.</p>
          )}
        </div>

        {/* Toolbar — beautified */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                placeholder="بحث بالنص (٣ كلمات)، رقم، أو سورة:آية (مثل 2:255)..."
                className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-smooth" />
            </div>
            {searchHint && (
              <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {searchHint}
              </div>
            )}
            <select value={surahFilter} onChange={(e) => { setSurahFilter(e.target.value); setPage(0); }}
              className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth">
              <option value="">كل السور</option>
              {SURAHS.map((s) => <option key={s.no} value={s.no}>{s.no}. {s.name}</option>)}
            </select>
            <div className="flex items-center gap-1 bg-gray-50 rounded-xl p-1 border border-gray-200">
              {(['all', 'green', 'red'] as VerseFilter[]).map((f) => (
                <button key={f} onClick={() => { setStatusFilter(f); setPage(0); }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-smooth ${
                    statusFilter === f
                      ? f === 'green' ? 'bg-emerald-500 text-white shadow-sm' : f === 'red' ? 'bg-red-500 text-white shadow-sm' : 'bg-accent-700 text-white shadow-sm'
                      : 'text-accent-500 hover:bg-gray-100'
                  }`}>
                  {f === 'all' ? 'الكل' : f === 'green' ? 'له رابط' : 'بدون رابط'}
                </button>
              ))}
            </div>
            <button onClick={exportExcel} className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-smooth shadow-sm">
              <Download className="w-4 h-4" /> تصدير
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded border-r-4 border-emerald-400 bg-emerald-50"></div>
              <span className="text-xs text-accent-500">آية لها رابط</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded border-r-4 border-red-400 bg-red-50"></div>
              <span className="text-xs text-accent-500">آية بدون روابط</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Bookmark className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-xs text-accent-500">سجلي المقطع يا رنا — تسجيل رابط</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Settings className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-xs text-accent-500">عرض الروابط</span>
            </div>
          </div>
        </div>

        {/* Verse table — beautified */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <div className="w-10 h-10 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
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
                        <span className="text-xs font-bold whitespace-nowrap">سجلي من هنا يا رنا</span>
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
                          <span className="flex items-center justify-center w-8 h-8 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg">{verse.surah_no}:{verse.ayah_no}</span>
                          <span className="text-sm font-semibold text-accent-700">{verse.surah_name}</span>
                          <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${verse.links_count > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-gray-500 bg-gray-50'}`}>
                            <Bookmark className="w-3 h-3" /> {verse.links_count || 0} رابط
                          </span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${verse.has_links ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                            {verse.has_links ? 'لها رابط' : 'بدون رابط'}
                          </span>
                        </div>
                        <p className="font-arabic text-lg text-accent-800 leading-loose line-clamp-2">{verse.ayah_text}</p>

                        {showLinksFor === verse.id && verseLinks.length > 0 && (
                          <div className="mt-3 space-y-1.5 animate-slide-up">
                            {verseLinks.map((link) => (
                              <div key={link.id} className="flex items-start gap-2 text-xs bg-white/80 rounded-lg p-2.5 border border-gray-100">
                                <span className={`px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${getLinkTypeColors(link.link_types)}`}>
                                  {formatTypes(link.link_types)}
                                </span>
                                <div className="flex-1 min-w-0">
                                  {link.link_title && <p className="font-semibold text-accent-700 mb-0.5">{link.link_title}</p>}
                                  <p className="text-accent-600 leading-relaxed">{link.link_content}</p>
                                  {link.audio_url && (
                                    <div className="flex items-center gap-1 mt-1">
                                      <Volume2 className="w-3 h-3 text-emerald-600" />
                                      <a href={link.audio_url} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline text-[10px]">مقطع رنا</a>
                                    </div>
                                  )}
                                  {link.status === 'pending' && <span className="text-[10px] text-amber-600 font-semibold">بانتظار المراجعة</span>}
                                </div>
                                <button onClick={() => deleteLink(link.id)} className="text-red-500 hover:bg-red-100 rounded p-1 flex-shrink-0"><Trash2 className="w-3 h-3" /></button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Large save button + show links */}
                      <div className="flex flex-col items-center gap-2 flex-shrink-0">
                        <button onClick={() => setLinkModalVerse(verse)}
                          title="سجلي المقطع يا رنا"
                          className="flex flex-col items-center justify-center gap-1 w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white rounded-2xl shadow-lg hover:shadow-xl transition-smooth">
                          <Mic className="w-6 h-6" />
                          <span className="text-[10px] font-bold leading-tight text-center">سجلي المقطع<br />يا رنا</span>
                        </button>
                        <button onClick={() => { if (showLinksFor === verse.id) { setShowLinksFor(null); } else { setShowLinksFor(verse.id); fetchVerseLinks(verse.id); } }}
                          title="عرض الروابط"
                          className={`flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg transition-smooth ${
                            showLinksFor === verse.id ? 'bg-emerald-500 text-white shadow-md' : 'bg-gray-50 text-accent-600 hover:bg-gray-100 border border-gray-200'
                          }`}>
                          <Settings className="w-3.5 h-3.5" /> الروابط
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
            <div className="flex items-center justify-between p-4 border-t border-gray-100 bg-gray-50">
              <p className="text-xs text-accent-500">صفحة {page + 1} من {totalPages} — {totalCount.toLocaleString('ar-EG')} آية</p>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="p-2 text-accent-600 hover:bg-white rounded-lg disabled:opacity-30 transition-smooth"><ChevronRight className="w-4 h-4" /></button>
                <span className="text-xs text-accent-600 px-2">{page + 1}</span>
                <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="p-2 text-accent-600 hover:bg-white rounded-lg disabled:opacity-30 transition-smooth"><ChevronLeft className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pending Links Review Modal */}
      {showPending && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto" onClick={() => setShowPending(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-accent-800">روابط بانتظار المراجعة ({pendingLinks.length})</h3>
              </div>
              <button onClick={() => setShowPending(false)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              {pendingLinks.length === 0 ? (
                <div className="text-center py-12 text-accent-400">
                  <Check className="w-10 h-10 mx-auto mb-2 text-emerald-400" />
                  <p>لا توجد روابط بانتظار المراجعة</p>
                </div>
              ) : (
                pendingLinks.slice(0, pendingVisible).map((link) => {
                  const verse = pendingVerses[link.verse_id];
                  return (
                    <div key={link.id} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                      {verse && (
                        <div className="mb-2 text-xs text-accent-400">
                          {verse.surah_name} — آية {verse.ayah_no}: <span className="font-arabic text-accent-600">{verse.ayah_text?.slice(0, 80)}...</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">{formatTypes(link.link_types)}</span>
                        {link.is_ai_draft && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">مسودة ذكاء اصطناعي</span>}
                        {link.audio_url && (
                          <a href={link.audio_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-emerald-600 hover:underline">
                            <Volume2 className="w-3 h-3" /> مقطع رنا الأصلي
                          </a>
                        )}
                      </div>

                      {editingLinkId === link.id ? (
                        <div className="mb-2">
                          <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3}
                            className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-lg text-sm focus:outline-none focus:border-emerald-500 resize-none" />
                          <div className="flex gap-2 mt-1">
                            <button onClick={() => saveEditText(link.id)} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg">
                              <Check className="w-3 h-3" /> حفظ النص
                            </button>
                            <button onClick={() => setEditingLinkId(null)} className="px-3 py-1.5 text-accent-500 text-xs hover:bg-gray-100 rounded-lg">إلغاء</button>
                          </div>
                        </div>
                      ) : (
                        <div className="mb-2">
                          {link.link_title && <p className="text-sm font-bold text-accent-700 mb-1">{link.link_title}</p>}
                          <p className="text-sm text-accent-600 leading-relaxed">{link.link_content}</p>
                          <button onClick={() => startEditText(link)} className="text-[11px] text-blue-600 hover:underline mt-1">تعديل النص مباشرة</button>
                        </div>
                      )}

                      {link.original_transcript && (
                        <details className="mt-2 mb-2">
                          <summary className="text-xs text-accent-400 cursor-pointer hover:text-accent-600">النص الأصلي المنطوق</summary>
                          <p className="text-xs text-accent-400 mt-1 p-2 bg-white rounded">{link.original_transcript}</p>
                        </details>
                      )}

                      <div className="bg-blue-50 rounded-lg p-3 border border-blue-100 mt-2">
                        <p className="text-xs font-semibold text-blue-700 mb-2">الصوت المخلّق للمستخدم</p>
                        {link.synthetic_audio_url ? (
                          <div className="flex items-center gap-2 mb-2">
                            <button onClick={() => new Audio(link.synthetic_audio_url!).play()}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg">
                              <Volume2 className="w-3.5 h-3.5" /> تشغيل ({link.voice_type === 'female' ? 'نسائي' : 'رجالي'})
                            </button>
                            <span className="text-[11px] text-blue-500">جاهز للنشر</span>
                          </div>
                        ) : (
                          <p className="text-[11px] text-blue-400 mb-2">لم يتم توليد الصوت بعد</p>
                        )}
                        <div className="flex gap-1.5">
                          <button onClick={() => generateVoiceForLink(link, 'male')} disabled={generatingVoiceId === link.id}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-blue-200 text-blue-700 text-xs font-semibold rounded-lg hover:bg-blue-50 disabled:opacity-50">
                            {generatingVoiceId === link.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <User className="w-3 h-3" />}
                            {link.synthetic_audio_url && link.voice_type === 'male' ? 'إعادة' : 'صوت رجالي'}
                          </button>
                          <button onClick={() => generateVoiceForLink(link, 'female')} disabled={generatingVoiceId === link.id}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-pink-200 text-pink-700 text-xs font-semibold rounded-lg hover:bg-pink-50 disabled:opacity-50">
                            {generatingVoiceId === link.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Heart className="w-3 h-3" />}
                            {link.synthetic_audio_url && link.voice_type === 'female' ? 'إعادة' : 'صوت نسائي'}
                          </button>
                        </div>
                      </div>

                      <div className="flex gap-2 mt-3">
                        <input type="text" value={rephraseCmd} onChange={(e) => setRephraseCmd(e.target.value)}
                          placeholder="طلب تعديل (اختياري): مثلاً — اجعله أقصر"
                          className="flex-1 px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-emerald-500" />
                        <button onClick={() => rephrasePending(link)} disabled={rephrasingId === link.id}
                          className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50">
                          <RefreshCw className="w-3 h-3" /> {rephrasingId === link.id ? '...' : 'صياغة'}
                        </button>
                      </div>

                      {proposals[link.id] && (
                        <div className="bg-violet-50 rounded-lg p-3 border border-violet-200 mt-3">
                          <p className="text-xs font-semibold text-violet-700 mb-1">صياغة مقترحة بالذكاء الاصطناعي{proposals[link.id].command ? ` (طلب: ${proposals[link.id].command})` : ''}</p>
                          <p className="text-sm text-accent-700 leading-relaxed mb-2">{proposals[link.id].text}</p>
                          <div className="flex gap-2">
                            <button onClick={() => applyProposal(link.id)} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg">اعتمديه يا رنا</button>
                            <button onClick={() => discardProposal(link.id)} className="px-3 py-1.5 text-accent-500 text-xs hover:bg-gray-100 rounded-lg">تجاهليه يا رنا</button>
                          </div>
                          <p className="text-[11px] text-accent-400 mt-1.5">النص الأصلي محفوظ زي ما هو لحد ما تعتمدي يا رنا — اطلبي تعديل تاني من الحقل اللي فوق وكرري لحد ما ترضي، وبعدين اعتمدي.</p>
                        </div>
                      )}
                                            <div className="flex gap-2 mt-3">
                        <button onClick={() => approveLink(link.id)}
                          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-smooth">
                          <Check className="w-4 h-4" /> اقبلي وانشري يا رنا
                        </button>
                        <button onClick={() => rejectLink(link.id)}
                          className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-smooth">
                          <X className="w-4 h-4" /> ارفضيه يا رنا
                        </button>
                      </div>
                    </div>
                  );
                })}
                {pendingVisible < pendingLinks.length && (
                  <button onClick={() => setPendingVisible((v) => v + 50)}
                    className="w-full py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm font-semibold rounded-lg border border-amber-200">
                    عرض المزيد ({pendingLinks.length - pendingVisible} متبقية)
                  </button>
                )}
              )}
            </div>
          </div>
        </div>
      )}

      {linkModalVerse && (
        <LinkModal verse={linkModalVerse} onClose={() => setLinkModalVerse(null)} onSaved={() => { setLinkModalVerse(null); fetchVerses(); fetchStats(); fetchPendingLinks(); }} />
      )}
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    red: 'bg-red-50 text-red-600 border-red-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
  };
  return (
    <div className={`p-5 rounded-2xl border ${colorMap[color]} flex items-center gap-4 shadow-sm hover:shadow-md transition-smooth`}>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colorMap[color]}`}>{icon}</div>
      <div>
        <p className="text-xs text-accent-500 font-semibold">{label}</p>
        <p className="text-2xl font-bold text-accent-800">{value.toLocaleString('ar-EG')}</p>
      </div>
    </div>
  );
}
