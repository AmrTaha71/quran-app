import { useState, useRef, useCallback, useEffect } from 'react';
import { useEscapeClose } from '../lib/useEscape';
import { supabase } from '../lib/supabase';
import { currentSpeechLocale } from '../lib/LanguageContext';
import type { QuranVerse } from '../lib/types';
import { LINK_TYPES, LINK_TYPE_HINTS } from '../lib/types';
import {
  X, Bookmark, Lightbulb, Mic, MicOff, Upload, Loader2,
  Check, RefreshCw, FileText, Sparkles, AlertCircle,
  User, Heart,
} from 'lucide-react';

type Phase = 'input' | 'confirm_recording' | 'processing' | 'review' | 'generating_voice' | 'saving' | 'done';

interface SpeechRecognitionResult { transcript: string; isFinal: boolean; }
interface SpeechRecognitionAlternative { 0: SpeechRecognitionResult; }
interface SpeechRecognitionEvent {
  results: { [key: number]: SpeechRecognitionAlternative; length: number };
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error?: string;
}

/** Arabic message for a browser speech-recognition failure. */
function recognitionErrorMessage(error?: string): string | null {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'تم رفض إذن الميكروفون. اسمحي بالميكروفون من إعدادات المتصفح ثم حاولي مرة أخرى.';
    case 'no-speech':
      return 'لم يتم سماع صوت واضح. تحدثي بصوت أعلى وأقرب إلى الميكروفون ثم حاولي مرة أخرى.';
    case 'audio-capture':
      return 'لم يتم العثور على ميكروفون يعمل على هذا الجهاز.';
    case 'network':
      return 'تعذر الاتصال بخدمة التعرف الصوتي. تحققي من الاتصال ثم حاولي مرة أخرى.';
    case 'aborted':
      return null; // Stopping the recording is not an error.
    default:
      return 'تعذر التعرف الصوتي المباشر. سيتم تجربة التحويل من الملف المسجل، أو اكتبي النص يدوياً.';
  }
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
  useEscapeClose(true, onClose);

  const [selectedTypes, setSelectedTypes] = useState<string[]>(['wajih']);
  const [linkContent, setLinkContent] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [error, setError] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [originalTranscript, setOriginalTranscript] = useState('');
  const [rephrasedText, setRephrasedText] = useState('');
  const [audioPublicUrl, setAudioPublicUrl] = useState<string | null>(null);
  // A recorded/uploaded take waiting for Rana's approval before it
  // becomes text: the blob plus any live transcript captured with it.
  const [pendingRecording, setPendingRecording] = useState<{ blob: Blob; transcript: string } | null>(null);
  const [syntheticAudioUrl, setSyntheticAudioUrl] = useState<string | null>(null);
  const [voiceType, setVoiceType] = useState<'male' | 'female'>('male');
  // Voice-source rule (2026-10-28, user's words): a generated voice
  // says the ORIGINAL recorded words by default — never the AI
  // rephrase. Only when she explicitly edits (manual textarea edit,
  // picking a non-original version, or a rephrase with her own
  // command) does generation follow the edited text. A fresh
  // transcript resets to the original.
  const [voiceFromEdited, setVoiceFromEdited] = useState(false);
  useEffect(() => { setVoiceFromEdited(false); }, [originalTranscript]);
  const [rephraseCommand, setRephraseCommand] = useState('');
  // AI version history for the approve-or-re-request loop: every
  // successful rephrase appends a version instead of destroying the
  // previous one, so the admin can compare and restore any version
  // before approving and saving.
  const [versions, setVersions] = useState<{ text: string; command: string; label: string }[]>([]);
  const [audioError, setAudioError] = useState('');
  const [reviewMode, setReviewMode] = useState<'rephrase' | 'keep_original'>('rephrase');
  const [liveTranscript, setLiveTranscript] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);
  const liveTranscriptRef = useRef('');
  // Final results only. Interim results are partial prefixes of the same
  // speech — appending them is what used to repeat sentences in the text.
  const finalTranscriptRef = useRef('');

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      recognitionRef.current = new SR();
      recognitionRef.current.lang = currentSpeechLocale();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.onresult = (e: SpeechRecognitionEvent) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          // isFinal lives on the RESULT, not its first alternative
          // (same bug as follow/self-test: finals were never counted).
          const res = e.results[i] as any;
          const result = res[0];
          if (res.isFinal || result.isFinal) {
            finalTranscriptRef.current += result.transcript + ' ';
          } else {
            interim += result.transcript + ' ';
          }
        }
        const display = (deduplicateTranscript(finalTranscriptRef.current.trim()) + ' ' + interim.trim()).trim();
        liveTranscriptRef.current = display;
        setLiveTranscript(display);
      };
      recognitionRef.current.onerror = (e: SpeechRecognitionErrorEvent) => {
        const message = recognitionErrorMessage(e.error);
        if (message) setError(message);
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
      finalTranscriptRef.current = '';
      setLiveTranscript('');

      // Start browser SpeechRecognition for live transcription
      if (recognitionRef.current) {
        try { recognitionRef.current.start(); } catch {}
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setError('هذا المتصفح لا يدعم التسجيل من الميكروفون. جرّبي متصفحاً آخر، أو ارفعي ملفاً صوتياً بالأسفل.');
        setIsRecording(false);
        return;
      }
      if (typeof MediaRecorder === 'undefined') {
        setError('هذا المتصفح لا يدعم تسجيل الصوت. ارفعي ملفاً صوتياً بالأسفل بدلاً من التسجيل المباشر.');
        setIsRecording(false);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Safari does not support audio/webm; fall back to audio/mp4 there.
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());

        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch {}
        }

        // Only final results become the transcript — interim prefixes are
        // shown live but never saved, so sentences no longer repeat.
        const rawTranscript = finalTranscriptRef.current.trim();
        const transcriptText = deduplicateTranscript(rawTranscript);

        try {
          const fileName = `rana-${Date.now()}.webm`;
          await supabase.storage.from('rana-audio').upload(fileName, blob);
          const { data: urlData } = supabase.storage.from('rana-audio').getPublicUrl(fileName);
          setAudioPublicUrl(urlData.publicUrl);
          // Rana approves the take first ("كويس التسجيل كده؟") — only
          // then does it become written text.
          setPendingRecording({ blob, transcript: transcriptText });
          setPhase('confirm_recording');
        } catch {
          // Was silently swallowed: the recording would vanish with no
          // trace. Surface it; the transcript flow below still proceeds.
          setAudioError('تعذر رفع المقطع يا رنا — سيُحفظ النص فقط، وهتحتاجي ترفعي الملف تاني بعدين.');
          if (transcriptText) {
            setOriginalTranscript(transcriptText);
            await doRephrase(transcriptText, '', 'rephrase');
          } else {
            await uploadAndTranscribeEdge(blob);
          }
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
    // Stop recognition first, then give its final result a moment to flush
    // before the recorder's onstop reads the transcript.
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setIsRecording(false);
    window.setTimeout(() => {
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    }, 400);
  }, []);

  // --- Fallback: edge function transcription ---
  // With existingUrl the audio is already uploaded (approved take), so it
  // is transcribed directly instead of being uploaded a second time.
  const uploadAndTranscribeEdge = async (audioBlob: Blob, existingUrl?: string) => {
    setPhase('processing');
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('يجب تسجيل الدخول'); setPhase('input'); return; }

      let audioUrl = existingUrl;
      if (!audioUrl) {
        const fileName = `rana-${Date.now()}.webm`;
        const { error: upErr } = await supabase.storage.from('rana-audio').upload(fileName, audioBlob);
        if (upErr) throw new Error('فشل رفع الملف الصوتي');

        const { data: urlData } = supabase.storage.from('rana-audio').getPublicUrl(fileName);
        setAudioPublicUrl(urlData.publicUrl);
        audioUrl = urlData.publicUrl;
      }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe-audio`, {
        method: 'POST',
        // LOCKDOWN 2026-10-30: transcribe-audio requires a logged-in
        // user JWT (verify_jwt=true). Session is already enforced
        // above, so the token exists here.
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ audioUrl }),
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
    // Upload first so Rana can hear it back and approve it, like a
    // recording, before it becomes text.
    try {
      const fileName = `rana-${Date.now()}.webm`;
      const { error: upErr } = await supabase.storage.from('rana-audio').upload(fileName, file);
      if (upErr) throw new Error('فشل رفع الملف الصوتي');
      const { data: urlData } = supabase.storage.from('rana-audio').getPublicUrl(fileName);
      setAudioPublicUrl(urlData.publicUrl);
      setPendingRecording({ blob: file, transcript: '' });
      setPhase('confirm_recording');
    } catch {
      setError('تعذر رفع الملف الصوتي. حاولي مرة أخرى.');
      setPhase('input');
    }
  };

  // --- Recording approval: the approved take becomes written text ---
  const approveRecording = async () => {
    const rec = pendingRecording;
    setPendingRecording(null);
    if (!rec) return;
    if (rec.transcript) {
      setOriginalTranscript(rec.transcript);
      await doRephrase(rec.transcript, '', 'rephrase');
    } else if (audioPublicUrl) {
      await uploadAndTranscribeEdge(rec.blob, audioPublicUrl);
    } else {
      await uploadAndTranscribeEdge(rec.blob);
    }
  };

  // Re-record: drop this take and go back to a fresh recording.
  const discardRecording = () => {
    setPendingRecording(null);
    setAudioPublicUrl(null);
    setAudioError('');
    setOriginalTranscript('');
    setLiveTranscript('');
    liveTranscriptRef.current = '';
    finalTranscriptRef.current = '';
    setPhase('input');
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Surface the real server error instead of a generic failure.
        throw new Error(data.error || `فشلت إعادة الصياغة (رمز ${res.status})`);
      }
      const result = data.rephrased || text;
      // Filter out placeholder text
      const finalResult = (result.includes('لم يتم تكوين') || result.includes('نص تجريبي')) ? text : result;
      setRephrasedText(finalResult);
      // Voice source follows the edit rule: keep_original = original
      // side (not an edit); a rephrase with her own command = her edit.
      if (mode === 'keep_original') setVoiceFromEdited(false);
      else if (command.trim()) setVoiceFromEdited(true);
      // Append to the version history (original first, then each AI
      // version). A re-request never overwrites an earlier version.
      setVersions((prev) => {
        const next = [...prev];
        if (next.length === 0 && text.trim()) {
          next.push({ text: text.trim(), command: '', label: 'النص الأصلي' });
        }
        if (next.length === 0 || next[next.length - 1].text !== finalResult) {
          next.push({
            text: finalResult,
            command,
            label: command
              ? `تعديل: ${command}`
              : mode === 'keep_original'
                ? 'النص المنقّى'
                : 'صياغة بالذكاء الاصطناعي',
          });
        }
        return next;
      });
      if (data.ai_used === false) {
        setError('تنبيه: تمت المعالجة محلياً لأن مفتاح الذكاء الاصطناعي غير متوفر — هذه النتيجة ليست من نموذج ذكاء اصطناعي. راجعيها قبل الحفظ.');
      }
      setReviewMode(mode);
      setSyntheticAudioUrl(null);
      setPhase('review');
    } catch (err: any) {
      // Never destroy a good draft because a re-request failed: keep
      // the current text and just report the failure. Only a first
      // attempt (no draft yet) falls back to showing the original.
      setError(`تعذرت إعادة الصياغة بالذكاء الاصطناعي: ${err?.message || 'خطأ غير معروف'}. ${rephrasedText.trim() ? 'تم الاحتفاظ بالنص الحالي.' : 'تم عرض النص الأصلي، ويمكنك تعديله يدوياً قبل الحفظ.'}`);
      if (!rephrasedText.trim()) setRephrasedText(text);
      setReviewMode(mode);
      setSyntheticAudioUrl(null);
      setPhase('review');
    }
  };

  // --- Generate Synthetic Voice (with browser TTS fallback) ---
  // Source follows the edit rule: the original transcript by default,
  // the edited text only when she explicitly edited.
  const generateVoice = async () => {
    const voiceText = voiceFromEdited ? rephrasedText : (originalTranscript || rephrasedText);
    if (!voiceText.trim()) return;
    setPhase('generating_voice');
    setError('');
    try {
      // LOCKDOWN 2026-10-29: generate-voice requires a logged-in user
      // JWT (the public anon key is rejected by the function).
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ text: voiceText, voice: voiceType }),
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
      // Gendered slot (2026-10-28) + legacy mirror, same as AdminPage.
      synthetic_audio_url_female: syntheticAudioUrl && voiceType === 'female' ? syntheticAudioUrl : null,
      synthetic_audio_url_male: syntheticAudioUrl && voiceType === 'male' ? syntheticAudioUrl : null,
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
      u.lang = currentSpeechLocale();
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
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg polish-modal-enter my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-hairline sticky top-0 bg-white rounded-t-2xl z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
              <Bookmark className="w-4 h-4 text-emerald-600" />
            </div>
            <h3 className="font-semibold text-accent-800">إنشاء رابط للآية</h3>
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="icon-action p-1.5 text-ink-3 hover:bg-gray-100 rounded-lg transition-smooth">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Verse context */}
          <div className="bg-gray-50 rounded-2xl p-3">
            <p className="text-xs text-accent-600 mb-1">{verse.surah_name} — آية {verse.ayah_no}</p>
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
                    selectedTypes.includes(t.value) ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' : 'bg-white text-accent-600 border-hairline hover:border-hairline-emerald'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
            {selectedTypes.length > 0 && (
              <p className="text-xs text-emerald-700 mt-1.5 flex items-center gap-1">
                <Lightbulb className="w-3 h-3" />
                {selectedTypes.map((t) => LINK_TYPE_HINTS[t]).join(' • ')}
              </p>
            )}
          </div>

          {/* Phase: Input */}
          {phase === 'input' && (
            <div className="space-y-3">
              <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-4 border border-hairline-emerald">
                <p className="text-sm font-semibold text-accent-700 mb-3 text-center">تسجيل صوتي مباشر يا رنا</p>
                <p className="text-xs text-accent-600 mb-4 text-center">سجلي المقطع يا رنا — سيتم تحويله لنص أثناء التسجيل</p>
                <div className="flex flex-col gap-2.5">
                  <button onClick={isRecording ? stopRecording : startRecording}
                    className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-smooth ${
                      isRecording ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse' : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md'
                    }`}>
                    {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    {isRecording ? 'وقفي التسجيل يا رنا' : 'سجلي مباشر يا رنا'}
                  </button>
                  {isRecording && liveTranscript && (
                    <div className="bg-white rounded-2xl p-3 border border-hairline-emerald animate-fade-in">
                      <p className="text-xs text-emerald-700 font-semibold mb-1">يتم التحويل الآن:</p>
                      <p className="text-sm text-accent-700">{liveTranscript}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-px bg-gray-200" /><span className="text-xs text-accent-600">أو</span><div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <label className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold bg-white border-2 border-hairline-emerald text-emerald-700 hover:bg-emerald-50 cursor-pointer transition-smooth">
                    <Upload className="w-5 h-5" /> رفع ملف صوتي
                    <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-3 border border-hairline">
                <p className="text-xs text-accent-600 mb-2 flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> أو إدخال نص يدوياً</p>
                <textarea value={linkContent} onChange={(e) => setLinkContent(e.target.value)}
                  placeholder="اكتب العلامة أو اللفظ أو المفهوم..." rows={3}
                  className="w-full px-3 py-2 bg-white border border-hairline rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth resize-none" />
                {linkContent.trim() && (
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => { setOriginalTranscript(linkContent.trim()); doRephrase(linkContent.trim(), '', 'rephrase'); }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg transition-smooth">
                      <Sparkles className="w-3.5 h-3.5" /> إعادة صياغة بلغة سهلة يا رنا
                    </button>
                    <button onClick={() => { setOriginalTranscript(''); setRephrasedText(linkContent.trim()); setReviewMode('keep_original'); setPhase('review'); }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-smooth">
                      <Mic className="w-3.5 h-3.5" /> تحويل لصوت
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Phase: Confirm recording — Rana approves the take first */}
          {phase === 'confirm_recording' && (
            <div className="space-y-3 animate-slide-up">
              <div className="bg-emerald-50 rounded-xl p-4 border border-hairline-emerald text-center">
                <p className="text-sm font-semibold text-accent-800 mb-3">كويس التسجيل كده؟</p>
                {audioPublicUrl && (
                  <button onClick={() => playAudio(audioPublicUrl)}
                    className="flex items-center justify-center gap-2 mx-auto px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold rounded-xl transition-smooth">
                    <Mic className="w-4 h-4" /> تشغيل المقطع (صوت رنا)
                  </button>
                )}
                <p className="text-xs text-accent-600 mt-3">بعد الاعتماد ح نحوّل التسجيل لنص مكتوب، وتقدري تحوّلي نسخة منه لصوت رجالي من شاشة المراجعة</p>
              </div>
              <div className="flex gap-2">
                <button onClick={approveRecording}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition-smooth text-sm shadow-md">
                  <Check className="w-5 h-5" /> تمام اعتمد التسجيل
                </button>
                <button onClick={discardRecording}
                  className="flex-1 py-3 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-xl transition-smooth text-sm">
                  لا ح أعيد التسجيل
                </button>
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
              <p className="text-xs text-accent-600">تحويل النص إلى مقطع صوتي {voiceType === 'male' ? 'بصوت رجالي' : 'بصوت نسائي'}</p>
            </div>
          )}

          {/* Phase: Review */}
          {phase === 'review' && (
            <div className="space-y-3 animate-slide-up">
              {/* Rana's original audio */}
              {audioPublicUrl && (
                <div className="flex items-center gap-2 bg-emerald-50 rounded-2xl p-2.5">
                  <Mic className="w-4 h-4 text-emerald-600" />
                  <button onClick={() => playAudio(audioPublicUrl)} className="text-xs font-semibold text-emerald-700 hover:underline">
                    تشغيل المقطع الأصلي (صوت رنا)
                  </button>
                </div>
              )}
              {audioError && !audioPublicUrl && (
                <div className="p-2.5 bg-amber-50 border border-hairline-amber rounded-2xl text-xs text-amber-link text-center">
                  {audioError}
                </div>
              )}

              {/* Original transcript */}
              {originalTranscript && (
                <div className="bg-white rounded-2xl p-3 border border-hairline">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-accent-600">النص المنطوق الأصلي</span>
                    <button onClick={() => playBrowserTTS(originalTranscript, voiceType)} className="text-accent-400 hover:text-emerald-600"><Mic className="w-4 h-4" /></button>
                  </div>
                  <p className="text-sm text-accent-600 leading-relaxed">{originalTranscript}</p>
                </div>
              )}

              {/* Rephrased text */}
              <div className="bg-violet-50 rounded-2xl p-3 border border-violet-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-violet-600">{reviewMode === 'keep_original' ? 'النص المنقّى' : 'النص المعاد صياغته'}</span>
                  <button onClick={() => playTTS(rephrasedText)} className="text-violet-400 hover:text-violet-600"><Mic className="w-4 h-4" /></button>
                </div>
                <textarea value={rephrasedText} onChange={(e) => { setRephrasedText(e.target.value); setSyntheticAudioUrl(null); setVoiceFromEdited(true); }}
                  rows={4}
                  className="w-full px-3 py-2 bg-white border border-violet-200 rounded-xl text-sm text-accent-700 leading-relaxed focus:outline-none focus:border-violet-500 transition-smooth resize-none" />
              </div>

              {/* Voice type selection + generate */}
              <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                <p className="text-xs font-semibold text-accent-600 mb-2">حوّل نسخة من النص لصوت</p>
                <div className="flex gap-2 mb-2">
                  <button onClick={() => setVoiceType('male')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg border transition-smooth ${
                      voiceType === 'male' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-accent-600 border-hairline hover:border-blue-300'
                    }`}>
                    <User className="w-3.5 h-3.5" /> صوت رجالي
                  </button>
                  <button onClick={() => setVoiceType('female')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg border transition-smooth ${
                      voiceType === 'female' ? 'bg-pink-600 text-white border-pink-600' : 'bg-white text-accent-600 border-hairline hover:border-pink-300'
                    }`}>
                    <Heart className="w-3.5 h-3.5" /> صوت نسائي
                  </button>
                </div>
                <button onClick={generateVoice}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-smooth">
                  <Mic className="w-4 h-4" /> {voiceType === 'male' ? 'يلا حوّل نسخة منه لصوت رجالي' : 'حوّل نسخة منه لصوت نسائي'}
                </button>
                <p className="text-xs text-accent-600 text-center mt-1.5">
                  {voiceFromEdited ? 'سيُحوَّل النص المعدّل' : originalTranscript ? 'سيُحوَّل النص الأصلي المسجّل' : 'سيُحوَّل النص الحالي'}
                </p>
                {/* Browser TTS fallback button */}
                {!syntheticAudioUrl && (
                  <button onClick={() => playBrowserTTS(rephrasedText, voiceType)}
                    className="w-full flex items-center justify-center gap-2 py-2 mt-2 bg-white border border-blue-200 hover:bg-blue-50 text-blue-700 text-xs font-semibold rounded-lg transition-smooth">
                    <Mic className="w-3.5 h-3.5" /> استماع عبر المتصفح ({voiceType === 'male' ? 'رجالي' : 'نسائي'})
                  </button>
                )}
              </div>

              {/* Synthetic audio preview */}
              {syntheticAudioUrl && (
                <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl p-3 border border-blue-200 animate-slide-up">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Mic className="w-4 h-4 text-blue-600" />
                      <span className="text-xs font-semibold text-blue-700">
                        الصوت المولّد ({voiceType === 'male' ? 'رجالي' : 'نسائي'})
                      </span>
                    </div>
                    <button onClick={() => playAudio(syntheticAudioUrl)} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-smooth">
                      <Mic className="w-3.5 h-3.5" /> تشغيل
                    </button>
                  </div>
                </div>
              )}

              {/* Title */}
              <input type="text" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="عنوان مختصر (اختياري)"
                className="w-full px-3 py-2 bg-gray-50 border border-hairline rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />

              {/* AI version history: the approve-or-re-request loop */}
              {versions.length > 1 && (
                <div className="bg-white rounded-2xl p-3 border border-hairline">
                  <p className="text-xs font-semibold text-accent-600 mb-2">نسخ الصياغة يا رنا — اختاري أي نسخة لعرضها، وبعدين وافقي واحفظي أو اطلبي تعديل جديد</p>
                  <div className="space-y-1.5">
                    {versions.map((v, i) => {
                      const isActive = v.text === rephrasedText;
                      return (
                        <div key={i} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 border ${isActive ? 'bg-emerald-50 border-emerald-300' : 'bg-gray-50 border-transparent'}`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-violet-600">{v.label}</p>
                            <p className="text-xs text-accent-600">{v.text}</p>
                            {isActive && <p className="text-xs font-medium text-emerald-700 mt-0.5">✓ النسخة المعروضة حالياً</p>}
                          </div>
                          <button onClick={() => { setRephrasedText(v.text); setSyntheticAudioUrl(null); setVoiceFromEdited(v.text.trim() !== originalTranscript.trim()); }}
                            className={`flex-shrink-0 px-2.5 py-1.5 text-white text-xs font-semibold rounded-lg ${isActive ? 'bg-emerald-700' : 'bg-violet-600 hover:bg-violet-700'}`}>
                            استخدام هذه النسخة
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Rephrase command */}
              <div className="flex gap-2">
                <input type="text" value={rephraseCommand} onChange={(e) => setRephraseCommand(e.target.value)}
                  placeholder="تعديل إضافي: مثلاً — اجعله أقصر"
                  className="flex-1 px-3 py-2 bg-gray-50 border border-hairline rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-smooth" />
                <button onClick={() => doRephrase(originalTranscript || linkContent, rephraseCommand, 'rephrase')}
                  className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg transition-smooth whitespace-nowrap">
                  <RefreshCw className="w-3.5 h-3.5" /> حاول تصيغ بصورة أفضل
                </button>
              </div>

              {error && (
                <div className="p-2.5 bg-amber-50 border border-hairline-amber rounded-2xl text-xs text-amber-link text-center flex items-center justify-center gap-2">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}

              {/* Actions: Rana's own words for the written text */}
              <p className="text-sm font-semibold text-emerald-700 text-center pt-1">النص المكتوب حلو كده يا رنا؟</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={handleSave}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition-smooth text-sm shadow-md hover:shadow-lg">
                  <Check className="w-5 h-5" /> اه ده كويس كده
                </button>
                <button onClick={() => doRephrase(originalTranscript || linkContent, rephraseCommand, 'rephrase')}
                  className="flex items-center gap-1.5 px-3 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl transition-smooth">
                  <RefreshCw className="w-4 h-4" /> لا مش حلو، حاول تاني
                </button>
                <button onClick={() => doRephrase(originalTranscript || linkContent, '', 'keep_original')}
                  className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-600 hover:bg-gray-700 text-white text-sm font-semibold rounded-xl transition-smooth">
                  <FileText className="w-4 h-4" /> لا خلاص التزم بالنص الأصلي
                </button>
              </div>
              <p className="text-xs text-accent-600 text-center">سيتم إرسال الرابط للمراجعة من قبل الإدارة قبل نشره</p>
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
              <p className="text-sm font-semibold text-accent-800">تم يا رنا — اتبعت الرابط للمراجعة بنجاح</p>
              <p className="text-xs text-accent-600">سيظهر للمستخدمين بعد موافقة الإدارة</p>
            </div>
          )}

          {phase === 'input' && error && (
            <div className="p-2.5 bg-amber-50 border border-hairline-amber rounded-2xl text-xs text-amber-link text-center flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
