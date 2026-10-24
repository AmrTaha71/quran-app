import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { QuranVerse } from '../lib/types';
import {
  Mic, MicOff, Check, X, Volume2, Loader2, Sparkles, FileText,
  RefreshCw, Edit3,
} from 'lucide-react';

// Web Speech API types
interface SpeechRecognitionResult {
  transcript: string;
}
interface SpeechRecognitionEvent {
  results: { [key: number]: { [key: number]: SpeechRecognitionResult } };
  resultIndex: number;
}

export default function SmartRephraseBox({ verse }: { verse: QuranVerse }) {
  const [mode, setMode] = useState<'idle' | 'recording' | 'processing' | 'result'>('idle');
  const [originalText, setOriginalText] = useState('');
  const [rephrasedText, setRephrasedText] = useState('');
  const [error, setError] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isListeningCommand, setIsListeningCommand] = useState(false);
  const [commandText, setCommandText] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'rejected'>('idle');
  const recognitionRef = useRef<any>(null);

  // Initialize speech recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.lang = 'ar-SA';
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
    }
  }, []);

  const startRecording = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      // Fallback: use text input mode
      setMode('result');
      setOriginalText(verse.ayah_text);
      setError('المتصفح لا يدعم التعرف الصوتي. استخدم إدخال النص يدوياً.');
      return;
    }

    setIsRecording(true);
    setError('');
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      setOriginalText(transcript);
      setIsRecording(false);
      processRephrase(transcript, '');
    };
    recognition.onerror = () => {
      setIsRecording(false);
      setError('تعذر التعرف على الصوت. حاول مرة أخرى.');
      setMode('idle');
    };
    recognition.onend = () => {
      setIsRecording(false);
    };
    recognition.start();
  }, [verse]);

  const processRephrase = async (text: string, command: string) => {
    setMode('processing');
    setError('');

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/smart-rephrase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ text, command }),
      });

      if (!response.ok) throw new Error('فشل في معالجة النص');
      const data = await response.json();
      setRephrasedText(data.rephrased || 'لم يتم الحصول على نتيجة');
      setMode('result');
    } catch (err) {
      setError('تعذر الاتصال بالخدمة. تأكد من إعداد مفتاح الذكاء الاصطناعي.');
      setMode('idle');
    }
  };

  const handleAccept = async () => {
    try {
      await supabase.from('rephrased_contents').insert({
        verse_id: verse.id,
        original_text: originalText,
        rephrased_text: rephrasedText,
        status: 'approved',
      });
      setSaveStatus('saved');
      setTimeout(() => resetAll(), 2000);
    } catch {
      setError('حدث خطأ أثناء الحفظ');
    }
  };

  const handleReject = () => {
    setSaveStatus('rejected');
    setTimeout(() => resetAll(), 1500);
  };

  const resetAll = () => {
    setMode('idle');
    setOriginalText('');
    setRephrasedText('');
    setError('');
    setSaveStatus('idle');
    setCommandText('');
  };

  // Voice command for modification
  const startCommandListening = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    setIsListeningCommand(true);
    setCommandText('');
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      setCommandText(transcript);
      setIsListeningCommand(false);

      // Check for accept/reject keywords
      if (transcript.includes('قبول')) {
        handleAccept();
        return;
      }
      if (transcript.includes('رفض')) {
        handleReject();
        return;
      }

      // Otherwise treat as modification command
      processRephrase(originalText, transcript);
    };
    recognition.onerror = () => setIsListeningCommand(false);
    recognition.onend = () => setIsListeningCommand(false);
    recognition.start();
  };

  // TTS playback
  const playTTS = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ar-SA';
    utterance.rate = 0.8;
    window.speechSynthesis.speak(utterance);
  };

  if (mode === 'idle') {
    return (
      <div className="bg-gradient-to-br from-violet-50 to-emerald-50 rounded-xl border border-violet-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-violet-600" />
          <h4 className="text-sm font-bold text-accent-800">إعادة الصياغة الذكية</h4>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={startRecording}
            disabled={isRecording}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg transition-smooth disabled:opacity-50"
          >
            {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            {isRecording ? 'جارٍ التسجيل...' : 'تسجيل صوتي'}
          </button>
          <button
            onClick={() => {
              setOriginalText(verse.ayah_text);
              processRephrase(verse.ayah_text, '');
            }}
            className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-gray-50 text-accent-700 text-sm font-semibold rounded-lg border border-gray-200 transition-smooth"
          >
            <FileText className="w-4 h-4" />
            صياغة الآية
          </button>
        </div>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>
    );
  }

  if (mode === 'processing') {
    return (
      <div className="bg-gradient-to-br from-violet-50 to-emerald-50 rounded-xl border border-violet-100 p-4">
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-6 h-6 text-violet-600 animate-spin" />
          <span className="mr-2 text-sm text-accent-600">جارٍ المعالجة بالذكاء الاصطناعي...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-violet-50 to-emerald-50 rounded-xl border border-violet-100 p-4 animate-slide-up">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-600" />
          <h4 className="text-sm font-bold text-accent-800">إعادة الصياغة الذكية</h4>
        </div>
        <button onClick={resetAll} className="text-xs text-accent-400 hover:text-accent-600">إغلاق</button>
      </div>

      {saveStatus === 'saved' && (
        <div className="flex items-center gap-2 p-3 bg-emerald-100 text-emerald-700 rounded-lg text-sm font-semibold mb-3">
          <Check className="w-4 h-4" /> تم الحفظ بنجاح!
        </div>
      )}
      {saveStatus === 'rejected' && (
        <div className="flex items-center gap-2 p-3 bg-red-100 text-red-700 rounded-lg text-sm font-semibold mb-3">
          <X className="w-4 h-4" /> تم الرفض.
        </div>
      )}

      {saveStatus === 'idle' && (
        <>
          {/* Side by side display */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div className="bg-white rounded-lg p-3 border border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-accent-500">النص الأصلي</span>
                <button onClick={() => playTTS(originalText)} className="text-accent-400 hover:text-emerald-600">
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm text-accent-700 leading-relaxed">{originalText}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-violet-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-violet-600">النص المعاد صياغته</span>
                <button onClick={() => playTTS(rephrasedText)} className="text-violet-400 hover:text-violet-600">
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm text-accent-700 leading-relaxed">{rephrasedText}</p>
            </div>
          </div>

          {commandText && (
            <p className="text-xs text-violet-600 mb-2">الأمر الصوتي: "{commandText}"</p>
          )}

          {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleAccept}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-smooth"
            >
              <Check className="w-4 h-4" />
              قبول وحفظ
            </button>
            <button
              onClick={handleReject}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-smooth"
            >
              <X className="w-4 h-4" />
              رفض
            </button>
            <button
              onClick={startCommandListening}
              disabled={isListeningCommand}
              className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-gray-50 text-accent-700 text-sm font-semibold rounded-lg border border-gray-200 transition-smooth disabled:opacity-50"
            >
              {isListeningCommand ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              {isListeningCommand ? 'جارٍ الاستماع...' : 'تعديل صوتي'}
            </button>
            <button
              onClick={() => processRephrase(originalText, commandText)}
              className="flex items-center gap-1.5 px-3 py-2 text-accent-500 hover:bg-gray-100 text-sm rounded-lg transition-smooth"
            >
              <RefreshCw className="w-4 h-4" />
              إعادة
            </button>
          </div>
        </>
      )}
    </div>
  );
}
