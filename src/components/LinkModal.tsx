import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { QuranVerse } from '../lib/types';
import { LINK_TYPES, LINK_TYPE_HINTS } from '../lib/types';
import {
  X, Bookmark, Lightbulb, Mic, MicOff, Upload, Loader2,
  Volume2, Check, RefreshCw, FileText, Sparkles, AlertCircle,
  AudioLines, User, Heart,
} from 'lucide-react';

type Phase = 'input' | 'processing' | 'review' | 'generating_voice' | 'saving' | 'done';

interface SpeechRecognitionResult { transcript: string; isFinal: boolean; }
interface SpeechRecognitionAlternative { 0: SpeechRecognitionResult; }
interface SpeechRecognitionEvent {
  results: { [key: number]: SpeechRecognitionAlternative; length: number };
  resultIndex: number;
}

function deduplicateTranscript(text: string): string {
  const sentences = text.split(/([.،!؟\n])/).filter((s) => s.trim());
  const seen = new Set<string>();
  const unique: string[] = [];
  let currentSentence = '';
  for (const part of sentences) {
    currentSentence += part;
    if (/[.،!؟\n]/.test(part)) {
      const clean = currentSentence.trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        unique.push(clean);
      }
      currentSentence = '';
    }
  }
  if (currentSentence.trim() && !seen.has(currentSentence.trim())) {
    unique.push(currentSentence.trim());
  }
  return unique.join(' ');
}

export default function LinkModal({
  verse, onClose, onSaved,
}: {
  verse: QuranVerse;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['wajih']);
  const [linkContent, setLinkContent] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [error, setError] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [originalTranscript, setOriginalTranscript] = useState('');
  const [rephrasedText, setRephrasedText] = useState('');
  const [audioPublicUrl, setAudioPublicUrl] = useState<string | null>(null);
  const [syntheticAudioUrl, setSyntheticAudioUrl] = useState<string | null>(null);
  const [voiceType, setVoiceType] = useState<'male' | 'female'>('male');
  const [rephraseCommand, setRephraseCommand] = useState('');
  const [reviewMode, setReviewMode] = useState<'rephrase' | 'keep_original'>('rephrase');
  const [liveTranscript, setLiveTranscript] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);
  const liveTranscriptRef = useRef('');

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      recognitionRef.current = new SR();
      recognitionRef.current.lang = 'ar-SA';
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.onresult = (e: SpeechRecognitionEvent) => {
        let full = '';
        for (let i = 0; i < e.results.length; i++) {
          full += e.results[i][0].transcript + ' ';
        }
        const cleaned = deduplicateTranscript(full.trim());
        liveTranscriptRef.current = cleaned;
        setLiveTranscript(cleaned);
      };
    }
  }, []);

  const toggleType = (type: string) => {
    setSelectedTypes((prev) => prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]);
  };

  // --- Audio Recording with live browser transcription ---
  const startRecording = useCallback(async () => {
    try {
      liveTranscriptRef.current = '';
      setLiveTranscript('');

      // Start browser SpeechRecognition for live transcription
      if (recognitionRef.current) {
        try { recognitionRef.current.start(); } catch {}
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());

        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch {}
        }

        const rawTranscript = liveTranscriptRef.current.trim();
        const transcriptText = deduplicateTranscript(rawTranscript);

        try {
          const fileName = `rana-${Date.now()}.webm`;
          await supabase.storage.from('rana-audio').upload(fileName, blob);
          const { data: urlData } = supabase.storage.from('rana-audio').getPublicUrl(fileName);
          setAudioPublicUrl(urlData.publicUrl);
        } catch {

        }

        if (transcriptText) {
          setOriginalTranscript(transcriptText);
          await doRephrase(transcriptText, '', 'rephrase');
        } else {
          await uploadAndTranscribeEdge(blob);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setError('');
    } catch (err: any) {
      setError('تعذر الوصول إلى الميكروفون. تأكدي من السماح باستخدام الميكروفون ثم حاولي مرة أخرى.');
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    setIsRecording(false);
  }, []);

  // --- Fallback: edge function transcription ---
  const uploadAndTranscribeEdge = async (audioBlob: Blob) => {
    setPhase('processing');
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('يجب تسجيل الدخول'); setPhase('input'); return; }

      const fileName = `rana-${Date.now()}.webm`;
      const { error: upErr } = await supabase.storage.from('rana-audio').upload(fileName, audioBlob);
      if (upErr) throw new Error('فشل رفع الملف الصوتي');

      const { data: urlData } = supabase.storage.from('rana-audio').getPublicUrl(fileName);
      setAudioPublicUrl(urlData.publicUrl);

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ audioUrl: urlData.publicUrl }),
      });

      if (!res.ok) {
        // Edge function failed — let user type manually
        setError('تعذر التحويل التلقائي. اكتبي النص يدوياً بالأسفل.');
        setPhase('input');
        return;
      }

      const data = await res.json();
      if (data.error) {
        setError('تعذر التحويل التلقائي. اكتبي النص يدوياً بالأسفل.');
        setPhase('input');
        return;
      }

      const transcript = data.transcript || '';
      if (transcript.includes('نص تجريبي') || transcript.includes('لم يتم تكوين')) {
        setError('تعذر التحويل التلقائي. اكتبي النص يدوياً بالأسفل.');
        setPhase('input');
        return;
      }

      setOriginalTranscript(transcript);
      await doRephrase(transcript, '', 'rephrase');
    } catch {
      setError('تعذر التحويل التلقائي. اكتبي النص يدوياً بالأسفل.');
      setPhase('input');
    }
  };

  // --- File Upload ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/') && !file.name.match(/\.(webm|mp3|wav|ogg|m4a|aac|mp4)$/i)) {
      setError('صيغة الملف غير مدعومة.');
      return;
    }
    await uploadAndTranscribeEdge(file);
  };

  // --- Rephrase ---
  const doRephrase = async (text: string, command: string, mode: 'rephrase' | 'keep_original') => {
    setPhase('processing');
    setError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/smart-rephrase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ text, command, mode }),
      });
      if (!res.ok) throw new Error('فشلت إعادة الصياغة');
      const data = await res.json();
      const result = data.rephrased || text;
      // Filter out placeholder text
      if (result.includes('لم يتم تكوين') || result.includes('نص تجريبي')) {
        setRephrasedText(text);
      } else {
        setRephrasedText(result);
      }
      setReviewMode(mode);
      setSyntheticAudioUrl(null);
      setPhase('review');
    } catch {
      setRephrasedText(text);
      setReviewMode(mode);
      setSyntheticAudioUrl(null);
      setPhase('review');
    }
  };

  // --- Generate Synthetic Voice (with browser TTS fallback) ---
  const generateVoice = async () => {
    if (!rephrasedText.trim()) return;
    setPhase('generating_voice');
    setError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ text: rephrasedText, voice: voiceType }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        // Browser TTS fallback — generate audio blob from speechSynthesis
        // Since we can't easily capture speechSynthesis to a file,
        // we mark it as browser-only and play it directly
        setSyntheticAudioUrl(null);
        setError('سيتم تشغيل الصوت عبر المتصفح. اضغطي زر التشغيل بالأسفل للاستماع.');
        setPhase('review');
        return;
      }

      setSyntheticAudioUrl(data.audioUrl);
      setPhase('review');
    } catch {
      setSyntheticAudioUrl(null);
      setError('سيتم تشغيل الصوت عبر المتصفح. اضغطي زر التشغيل بالأسفل للاستماع.');
      setPhase('review');
    }
  };

  // --- Save Link ---
  const handleSave = async () => {
    if (!rephrasedText.trim() && !linkContent.trim()) { setError('لا يوجد محتوى'); return; }
    if (selectedTypes.length === 0) { setError('اختر نوعاً واحداً على الأقل'); return; }

    setPhase('saving');
    setError('');
    const finalContent = rephrasedText.trim() || linkContent.trim();

    const { error: saveError } = await supabase.from('ayah_links').insert({
      verse_id: verse.id,
      link_types: selectedTypes,
      link_content: finalContent,
      link_title: linkTitle.trim() || null,
      audio_url: audioPublicUrl,
      synthetic_audio_url: syntheticAudioUrl,
      voice_type: syntheticAudioUrl ? voiceType : null,
      original_transcript: originalTranscript || null,
      status: 'pending',
      rephrase_command: rephraseCommand || null,
      created_by: (await supabase.auth.getSession()).data.session?.user.id || null,
    });

    if (saveError) {
      setError('حدث خطأ أثناء الحفظ: ' + saveError.message);
      setPhase('review');
    } else {
      setPhase('done');
      setTimeout(() => onSaved(), 1200);
    }
  };

  const playAudio = (url: string) => { new Audio(url).play(); };

  const playBrowserTTS = (text: string, type: 'male' | 'female') => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ar-SA';
      u.rate = 0.85;
      const voices = window.speechSynthesis.getVoices();
      const arVoice = voices.find((v) => v.lang.startsWith('ar'));
      if (arVoice) u.voice = arVoice;
      u.pitch = type === 'female' ? 1.3 : 0.8;
      window.speechSynthesis.speak(u);
    }
  };

  const playTTS = (text: string) => playBrowserTTS(text, voiceType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-slide-up my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
              <Bookmark className="w-4 h-4 text-emerald-600" />
            </div>
            <h3 className="font-bold text-accent-800">إنشاء رابط للآية</h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-smooth">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Verse context */}
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-accent-400 mb-1">{verse.surah_name} — آية {verse.ayah_no}</p>
            <p className="font-arabic text-base text-accent-700 line-clamp-2">{verse.ayah_text}</p>
          </div>

          {/* Multi-type selection */}
          <div>
            <label className="block text-sm font-semibold text-accent-700 mb-1.5">
              نوع الرابط <span className="text-accent-400 font-normal">(يمكن اختيار أكثر من صفة)</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {LINK_TYPES.map((t) => (
                <button key={t.value} type="button" onClick={() => toggleType(t.value)}
                  className={`py-2 text-xs font-semibold rounded-lg border transition-smooth ${
                    selectedTypes.includes(t.value) ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' : 'bg-white text-accent-600 border-gray-200 hover:border-emerald-300'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
            {selectedTypes.length > 0 && (
              <p className="text-[11px] text-emerald-600 mt-1.5 flex items-center gap-1">
                <Lightbulb className="w-3 h-3" />
                {selectedTypes.map((t) => LINK_TYPE_HINTS[t]).join(' • ')}
              </p>
            )}
          </div>

          {/* Phase: Input */}
          {phase === 'input' && (
            <div className="space-y-3">
              <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-4 border border-emerald-100">
                <p className="text-sm font-semibold text-accent-700 mb-3 text-center">تسجيل صوتي مباشر</p>
                <p className="text-xs text-accent-500 mb-4 text-center">سجلي المقطع — سيتم تحويله لنص أثناء التسجيل</p>
                <div className="flex flex-col gap-2.5">
                  <button onClick={isRecording ? stopRecording : startRecording}
                    className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-smooth ${
                      isRecording ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse' : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md'
                    }`}>
                    {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    {isRecording ? 'إيقاف التسجيل' : 'تسجيل مباشر'}
                  </button>
                  {isRecording && liveTranscript && (
                    <div className="bg-white rounded-lg p-3 border border-emerald-200 animate-fade-in">
                      <p className="text-xs text-emerald-600 font-semibold mb-1">يتم التحويل الآن:</p>
                      <p className="text-sm text-accent-700">{liveTranscript}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-px bg-gray-200" /><span className="text-xs text-accent-400">أو</span><div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <label className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-white border-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 cursor-pointer transition-smooth">
                    <Upload className="w-5 h-5" /> رفع ملف صوتي
                    <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-xs text-accent-500 mb-2 flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> أو إدخال نص يدوياً</p>
                <textarea value={linkContent} onChange={(e) => setLinkContent(e.target.value)}
                  placeholder="اكتب العلامة أو اللفظ أو المفهوم..." rows={3}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-500 transition-smooth resize-none" />
                {linkContent.trim() && (
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => { setOriginalTranscript(linkContent.trim()); doRephrase(linkContent.trim(), '', 'rephrase'); }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg transition-smooth">
                      <Sparkles className="w-3.5 h-3.5" /> إعادة صياغة بلغة سهلة
                    </button>
                    <button onClick={() => { setOriginalTranscript(''); setRephrasedText(linkContent.trim()); setReviewMode('keep_original'); setPhase('review'); }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-smooth">
                      <AudioLines className="w-3.5 h-3.5" /> تحويل لصوت
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Phase: Processing */}
          {phase === 'processing' && (
            <div className="bg-violet-50 rounded-xl p-6 border border-violet-100 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
              <p className="text-sm font-semibold text-accent-700">
                {originalTranscript ? 'جارٍ إعادة الصياغة...' : 'جارٍ تحويل الصوت إلى نص...'}
              </p>
            </div>
          )}

          {/* Phase: Generating Voice */}
          {phase === 'generating_voice' && (
            <div className="bg-blue-50 rounded-xl p-6 border border-blue-100 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              <p className="text-sm font-semibold text-accent-700">جارٍ توليد الصوت...</p>
              <p className="text-xs text-accent-400">تحويل النص إلى مقطع صوتي {voiceType === 'male' ? 'بصوت رجالي' : 'بصوت نسائي'}</p>
            </div>
          )}

          {/* Phase: Review */}
          {phase === 'review' && (
            <div className="space-y-3 animate-slide-up">
              {/* Rana's original audio */}
              {audioPublicUrl && (
                <div className="flex items-center gap-2 bg-emerald-50 rounded-lg p-2.5">
                  <Volume2 className="w-4 h-4 text-emerald-600" />
                  <button onClick={() => playAudio(audioPublicUrl)} className="text-xs font-semibold text-emerald-700 hover:underline">
                    تشغيل المقطع الأصلي (صوت رنا)
                  </button>
                </div>
              )}

              {/* Original transcript */}
              {originalTranscript && (
                <div className="bg-white rounded-lg p-3 border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-accent-500">النص المنطوق الأصلي</span>
                    <button onClick={() => playBrowserTTS(originalTranscript, voiceType)} className="text-accent-400 hover:text-emerald-600"><Volume2 className="w-4 h-4" /></button>
                  </div>
                  <p className="text-sm text-accent-600 leading-relaxed">{originalTranscript}</p>
                </div>
              )}

              {/* Rephrased text */}
              <div className="bg-violet-50 rounded-lg p-3 border border-violet-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-violet-600">{reviewMode === 'keep_original' ? 'النص المنقّى' : 'النص المعاد صياغته'}</span>
                  <button onClick={() => playTTS(rephrasedText)} className="text-violet-400 hover:text-violet-600"><Volume2 className="w-4 h-4" /></button>
                </div>
                <textarea value={rephrasedText} onChange={(e) => { setRephrasedText(e.target.value); setSyntheticAudioUrl(null); }}
                  rows={4}
                  className="w-full px-3 py-2 bg-white border border-violet-200 rounded-lg text-sm text-accent-700 leading-relaxed focus:outline-none focus:border-violet-500 transition-smooth resize-none" />
              </div>

              {/* Voice type selection + generate */}
              <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                <p className="text-xs font-semibold text-accent-600 mb-2">توليد صوت للقارئ</p>
                <div className="flex gap-2 mb-2">
                  <button onClick={() => setVoiceType('male')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg border transition-smooth ${
                      voiceType === 'male' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-accent-600 border-gray-200 hover:border-blue-300'
                    }`}>
                    <User className="w-3.5 h-3.5" /> صوت رجالي
                  </button>
                  <button onClick={() => setVoiceType('female')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg border transition-smooth ${
                      voiceType === 'female' ? 'bg-pink-600 text-white border-pink-600' : 'bg-white text-accent-600 border-gray-200 hover:border-pink-300'
                    }`}>
                    <Heart className="w-3.5 h-3.5" /> صوت نسائي
                  </button>
                </div>
                <button onClick={generateVoice}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-smooth">
                  <AudioLines className="w-4 h-4" /> حول النص إلى مقطع صوتي
                </button>
                {/* Browser TTS fallback button */}
                {!syntheticAudioUrl && (
                  <button onClick={() => playBrowserTTS(rephrasedText, voiceType)}
                    className="w-full flex items-center justify-center gap-2 py-2 mt-2 bg-white border border-blue-200 hover:bg-blue-50 text-blue-700 text-xs font-semibold rounded-lg transition-smooth">
                    <Volume2 className="w-3.5 h-3.5" /> استماع عبر المتصفح ({voiceType === 'male' ? 'رجالي' : 'نسائي'})
                  </button>
                )}
              </div>

              {/* Synthetic audio preview */}
              {syntheticAudioUrl && (
                <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-lg p-3 border border-blue-200 animate-slide-up">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AudioLines className="w-4 h-4 text-blue-600" />
                      <span className="text-xs font-semibold text-blue-700">
                        الصوت المولّد ({voiceType === 'male' ? 'رجالي' : 'نسائي'})
                      </span>
                    </div>
                    <button onClick={() => playAudio(syntheticAudioUrl)} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-smooth">
                      <Volume2 className="w-3.5 h-3.5" /> تشغيل
                    </button>
                  </div>
                </div>
              )}

              {/* Title */}
              <input type="text" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="عنوان مختصر (اختياري)"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />

              {/* Rephrase command */}
              <div className="flex gap-2">
                <input type="text" value={rephraseCommand} onChange={(e) => setRephraseCommand(e.target.value)}
                  placeholder="تعديل إضافي: مثلاً — اجعله أقصر"
                  className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                <button onClick={() => doRephrase(originalTranscript || linkContent, rephraseCommand, 'rephrase')}
                  className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg transition-smooth whitespace-nowrap">
                  <RefreshCw className="w-3.5 h-3.5" /> صياغة بتعديل
                </button>
              </div>

              {error && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 text-center flex items-center justify-center gap-2">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={handleSave}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-smooth text-sm shadow-md hover:shadow-lg">
                  <Check className="w-5 h-5" /> الموافقة وحفظ الرابط
                </button>
                <button onClick={() => doRephrase(originalTranscript || linkContent, rephraseCommand, 'rephrase')}
                  className="flex items-center gap-1.5 px-3 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg transition-smooth">
                  <RefreshCw className="w-4 h-4" /> إعادة صياغة
                </button>
                <button onClick={() => doRephrase(originalTranscript || linkContent, '', 'keep_original')}
                  className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-600 hover:bg-gray-700 text-white text-sm font-semibold rounded-lg transition-smooth">
                  <FileText className="w-4 h-4" /> الالتزام بالنص
                </button>
              </div>
              <p className="text-[11px] text-accent-400 text-center">سيتم إرسال الرابط للمراجعة من قبل الإدارة قبل نشره</p>
            </div>
          )}

          {/* Phase: Saving */}
          {phase === 'saving' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
              <p className="text-sm font-semibold text-accent-700">جارٍ الحفظ...</p>
            </div>
          )}

          {/* Phase: Done */}
          {phase === 'done' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-600" />
              </div>
              <p className="text-sm font-bold text-accent-800">تم إرسال الرابط للمراجعة بنجاح</p>
              <p className="text-xs text-accent-400">سيظهر للمستخدمين بعد موافقة الإدارة</p>
            </div>
          )}

          {phase === 'input' && error && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 text-center flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
