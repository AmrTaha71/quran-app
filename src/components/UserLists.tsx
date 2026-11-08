import { useState, useEffect, useCallback, useRef } from 'react';
import { useEscapeClose } from '../lib/useEscape';
import { supabase } from '../lib/supabase';
import type { QuranVerse, AyahLink } from '../lib/types';
import { Bookmark, AlertTriangle, BadgeCheck, X } from 'lucide-react';

export type ListType = 'read_later' | 'difficult' | 'memorized';

export function useUserLists() {
  const [lists, setLists] = useState<Record<ListType, Set<number>>>({
    read_later: new Set(),
    difficult: new Set(),
    memorized: new Set(),
  });
  // Per-link labels: keys `${verseId}:${linkId}` for rows that carry a
  // link_id. The verse-level sets above still include those verses (a
  // verse with a labeled link shows in the matching filter), but only
  // this map can render a single link row's own active state.
  const [linkLists, setLinkLists] = useState<Record<'read_later' | 'difficult', Set<string>>>({
    read_later: new Set(),
    difficult: new Set(),
  });

  const fetchLists = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data } = await supabase
      .from('user_lists')
      .select('verse_id, link_id, list_type')
      .eq('user_id', session.user.id);

    if (data) {
      setLists({
        read_later: new Set(data.filter((d) => d.list_type === 'read_later').map((d) => d.verse_id)),
        difficult: new Set(data.filter((d) => d.list_type === 'difficult').map((d) => d.verse_id)),
        memorized: new Set(data.filter((d) => d.list_type === 'memorized').map((d) => d.verse_id)),
      });
      const linkKey = (d: { verse_id: number; link_id: unknown }) => `${d.verse_id}:${d.link_id}`;
      setLinkLists({
        read_later: new Set(data.filter((d) => d.list_type === 'read_later' && d.link_id != null).map(linkKey)),
        difficult: new Set(data.filter((d) => d.list_type === 'difficult' && d.link_id != null).map(linkKey)),
      });
    }
  }, []);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  const toggleList = async (verseId: number, listType: ListType, linkId?: number) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const isInList = lists[listType].has(verseId);

    if (isInList && !linkId) {
      await supabase.from('user_lists')
        .delete()
        .eq('user_id', session.user.id)
        .eq('verse_id', verseId)
        .eq('list_type', listType);
    } else {
      await supabase.from('user_lists').insert({
        user_id: session.user.id,
        verse_id: verseId,
        link_id: linkId || null,
        list_type: listType,
      });
    }

    await fetchLists();
  };

  // Per-link toggle (a true toggle, unlike the legacy verse path above
  // which inserts when a link_id is given even if the verse is already
  // listed): delete the exact (verse, link, type) row if present,
  // otherwise insert it. Same user_lists table, same list_type values.
  const toggleLinkList = async (verseId: number, linkId: number, listType: 'read_later' | 'difficult') => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase.from('user_lists')
      .select('verse_id')
      .eq('user_id', session.user.id)
      .eq('verse_id', verseId)
      .eq('link_id', linkId)
      .eq('list_type', listType)
      .limit(1);
    if (data && data.length > 0) {
      await supabase.from('user_lists').delete()
        .eq('user_id', session.user.id)
        .eq('verse_id', verseId)
        .eq('link_id', linkId)
        .eq('list_type', listType);
    } else {
      await supabase.from('user_lists').insert({
        user_id: session.user.id,
        verse_id: verseId,
        link_id: linkId,
        list_type: listType,
      });
    }
    await fetchLists();
  };

  return { lists, linkLists, toggleList, toggleLinkList, fetchLists };
}

export function ListToggleButtons({
  verse, lists, onToggle,
}: {
  verse: QuranVerse;
  lists: Record<ListType, Set<number>>;
  onToggle: (verseId: number, listType: ListType) => void;
}) {
  const items: { type: ListType; icon: React.ReactNode; activeColor: string }[] = [
    { type: 'read_later', icon: <Bookmark className="w-4 h-4" />, activeColor: 'bg-blue-500 text-white' },
    { type: 'difficult', icon: <AlertTriangle className="w-4 h-4" />, activeColor: 'bg-amber-500 text-white' },
    { type: 'memorized', icon: <BadgeCheck className="w-4 h-4" />, activeColor: 'bg-emerald-500 text-white' },
  ];

  return (
    <div className="flex items-center gap-1">
      {items.map((item) => (
        <button
          key={item.type}
          onClick={(e) => { e.stopPropagation(); onToggle(verse.id, item.type); }}
          title={item.type === 'read_later' ? 'أرجع لها لاحقاً' : item.type === 'difficult' ? 'صعبة' : 'تم الحفظ'}
          aria-label={item.type === 'read_later' ? 'أرجع لها لاحقاً' : item.type === 'difficult' ? 'صعبة' : 'تم الحفظ'}
          className={`icon-action p-1.5 rounded-lg transition-smooth ${
            lists[item.type].has(verse.id) ? item.activeColor : 'text-ink-3 hover:bg-gray-100'
          }`}
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
}

export function LongPressMenu({
  verse, onAddToList, onClose,
}: {
  verse: QuranVerse;
  onAddToList: (verseId: number, listType: ListType) => void;
  onClose: () => void;
}) {
  useEscapeClose(true, onClose);
  const items: { type: ListType; icon: React.ReactNode; color: string; label: string }[] = [
    { type: 'read_later', icon: <Bookmark className="w-4 h-4" />, color: 'text-blue-500 bg-blue-50', label: 'أرجع لها لاحقاً' },
    { type: 'difficult', icon: <AlertTriangle className="w-4 h-4" />, color: 'text-amber-link bg-amber-50', label: 'صعبة' },
    { type: 'memorized', icon: <BadgeCheck className="w-4 h-4" />, color: 'text-emerald-500 bg-emerald-50', label: 'تم الحفظ' },
  ];

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in p-4 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="إضافة إلى قائمة" className="bg-white rounded-3xl shadow-2xl p-5 w-full max-w-xs animate-slide-up my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-accent-800">إضافة إلى قائمة</p>
          <button onClick={onClose} aria-label="إغلاق" className="icon-action text-ink-3 hover:bg-gray-100 rounded-lg p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-accent-600 mb-3 text-center">{verse.surah_name} — آية {verse.ayah_no}</p>
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.type}
              onClick={() => { onAddToList(verse.id, item.type); onClose(); }}
              className={`w-full flex items-center gap-3 p-3 rounded-xl ${item.color} hover:opacity-80 transition-smooth`}
            >
              {item.icon}
              <span className="text-sm font-semibold">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function useLongPress(callback: () => void, ms = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(() => {
    timer.current = setTimeout(callback, ms);
  }, [callback, ms]);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { start, clear };
}

export function LinkLongPressMenu({
  verse, link, onAddToList, onClose,
}: {
  verse: QuranVerse;
  link: AyahLink;
  onAddToList: (verseId: number, listType: ListType, linkId?: number) => void;
  onClose: () => void;
}) {
  useEscapeClose(true, onClose);
  const items: { type: ListType; icon: React.ReactNode; color: string; label: string }[] = [
    { type: 'read_later', icon: <Bookmark className="w-5 h-5" />, color: 'text-blue-500 bg-blue-50 hover:bg-blue-100', label: 'أرجع لها لاحقاً' },
    { type: 'difficult', icon: <AlertTriangle className="w-5 h-5" />, color: 'text-amber-link bg-amber-50 hover:bg-amber-100', label: 'صعبة' },
    { type: 'memorized', icon: <BadgeCheck className="w-5 h-5" />, color: 'text-emerald-500 bg-emerald-50 hover:bg-emerald-100', label: 'تم الحفظ' },
  ];

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl p-5 w-full max-w-sm animate-slide-up my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-emerald-600" />
            <p className="text-sm font-semibold text-accent-800">إضافة الرابط إلى قائمة</p>
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="icon-action text-ink-3 hover:bg-gray-100 rounded-lg p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 mb-4">
          <p className="text-xs text-accent-600 mb-1">{verse.surah_name} — آية {verse.ayah_no}</p>
          <p className="text-xs text-accent-700 font-semibold">{link.link_title || link.link_content}</p>
        </div>
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.type}
              onClick={() => { onAddToList(verse.id, item.type, link.id); onClose(); }}
              className={`w-full flex items-center gap-3 p-3.5 rounded-xl ${item.color} transition-smooth`}
            >
              {item.icon}
              <span className="text-sm font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
