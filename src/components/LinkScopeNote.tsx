// User-facing note under a link: merged link ("this link joins ayat 13 and 14 of the same surah")
// or far link ("this link ties this ayah to <surah> ayah N"). Renders nothing for ordinary links.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AyahLink } from '../lib/types';

type V = { id: number; surah_no: number; surah_name: string; ayah_no: number };
const cache = new Map<number, V>();

async function load(ids: number[]): Promise<V[]> {
  const miss = ids.filter((i) => !cache.has(i));
  if (miss.length) {
    const { data } = await supabase.from('quran_verses').select('id,surah_no,surah_name,ayah_no').in('id', miss);
    (data || []).forEach((v) => cache.set(v.id as number, v as V));
  }
  return ids.map((i) => cache.get(i)).filter((v): v is V => !!v);
}

export default function LinkScopeNote({ link, verseId }: { link: AyahLink; verseId: number }) {
  const group = link.group_verse_ids && link.group_verse_ids.length > 1 ? link.group_verse_ids : null;
  // For a far link seen from the OTHER end, the "other" ayah is the anchor verse.
  const otherId = link.related_verse_id ? (link.related_verse_id === verseId ? link.verse_id : link.related_verse_id) : null;
  const [vs, setVs] = useState<V[]>([]);
  const key = `${group?.join(',') || ''}|${otherId || ''}`;
  useEffect(() => {
    let alive = true;
    const ids = group ? group : otherId ? [otherId] : [];
    if (ids.length) load(ids).then((r) => { if (alive) setVs(r); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!vs.length) return null;
  if (group) {
    const nums = vs.slice().sort((a, b) => a.ayah_no - b.ayah_no).map((v) => v.ayah_no.toLocaleString('ar-EG'));
    return (
      <p dir="rtl" className="mt-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 rounded-lg px-2 py-1">
        التربيط ده بيجمع الآيات {nums.join(' و ')} من سورة {vs[0].surah_name}
      </p>
    );
  }
  const o = vs[0];
  return (
    <p dir="rtl" className="mt-1 text-[11px] font-semibold text-amber-800 bg-amber-50 rounded-lg px-2 py-1">
      التربيط ده بيربط الآية دي بـ {o.surah_name} — آية {o.ayah_no.toLocaleString('ar-EG')}
    </p>
  );
}
