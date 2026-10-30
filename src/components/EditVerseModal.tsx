import { useState } from 'react';
import { useEscapeClose } from '../lib/useEscape';
import { supabase } from '../lib/supabase';
import type { QuranVerse } from '../lib/types';
import { X, Save, Edit3 } from 'lucide-react';

export default function EditVerseModal({
  verse,
  onClose,
  onSaved,
}: {
  verse: QuranVerse;
  onClose: () => void;
  onSaved: () => void;
}) {
  useEscapeClose(true, onClose);

  const [surahNo, setSurahNo] = useState(verse.surah_no);
  const [surahName, setSurahName] = useState(verse.surah_name);
  const [ayahNo, setAyahNo] = useState(verse.ayah_no);
  const [ayahText, setAyahText] = useState(verse.ayah_text);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ayahText.trim()) {
      setError('نص الآية لا يمكن أن يكون فارغاً');
      return;
    }
    setSaving(true);
    setError('');

    const { error } = await supabase
      .from('quran_verses')
      .update({
        surah_no: surahNo,
        surah_name: surahName,
        ayah_no: ayahNo,
        ayah_text: ayahText.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', verse.id);

    if (error) {
      setError('حدث خطأ: ' + error.message);
    } else {
      onSaved();
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (verse.is_protected) {
      setError('لا يمكن حذف آية محمية');
      return;
    }
    if (!confirm('هل أنت متأكد من الحذف؟')) return;
    const { error } = await supabase.from('quran_verses').delete().eq('id', verse.id);
    if (error) {
      setError('حدث خطأ: ' + error.message);
    } else {
      onSaved();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-slide-up my-auto">
        <div className="flex items-center justify-between p-4 border-b border-hairline">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-accent-50 rounded-lg flex items-center justify-center">
              <Edit3 className="w-4 h-4 text-accent-600" />
            </div>
            <h3 className="font-bold text-accent-800">تعديل الآية</h3>
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="icon-action p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-smooth">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-accent-600 mb-1">رقم السورة</label>
                <input
                  type="number"
                  min={1}
                  max={114}
                  value={surahNo}
                  onChange={(e) => setSurahNo(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 bg-gray-50 border border-hairline rounded-lg text-sm focus:outline-none focus:border-emerald-500 transition-smooth"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-accent-600 mb-1">اسم السورة</label>
                <input
                  type="text"
                  value={surahName}
                  onChange={(e) => setSurahName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-hairline rounded-lg text-sm focus:outline-none focus:border-emerald-500 transition-smooth"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-accent-600 mb-1">رقم الآية</label>
                <input
                  type="number"
                  min={1}
                  value={ayahNo}
                  onChange={(e) => setAyahNo(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 bg-gray-50 border border-hairline rounded-lg text-sm focus:outline-none focus:border-emerald-500 transition-smooth"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-accent-600 mb-1">نص الآية</label>
              <textarea
                value={ayahText}
                onChange={(e) => setAyahText(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 bg-gray-50 border border-hairline rounded-lg text-lg font-arabic focus:outline-none focus:border-emerald-500 transition-smooth resize-none"
                dir="rtl"
              />
            </div>

            {error && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 text-center">
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-smooth disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
              </button>
              {!verse.is_protected && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-4 py-2.5 text-red-600 hover:bg-red-50 font-semibold rounded-lg transition-smooth border border-red-200"
                >
                  حذف
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-accent-600 hover:bg-gray-100 font-semibold rounded-lg transition-smooth"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
