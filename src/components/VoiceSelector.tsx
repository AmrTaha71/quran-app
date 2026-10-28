import { useEffect, useState } from 'react';
import { Volume2, VolumeX, Settings2 } from 'lucide-react';
import { VOICE_OPTIONS, type VoiceType } from '../lib/types';
import { currentSpeechLocale } from '../lib/LanguageContext';

const STORAGE_KEY = 'quran-voice-preference';

export default function VoiceSelector({ text }: { text: string }) {
  const [selectedVoice, setSelectedVoice] = useState<VoiceType>('majood');
  const [isPlaying, setIsPlaying] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savedPref, setSavedPref] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setSelectedVoice(saved as VoiceType);
  }, []);

  const playTTS = () => {
    if (!('speechSynthesis' in window)) return;

    if (isPlaying) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = currentSpeechLocale();

    // Voice settings based on selection
    const voiceConfig: Record<VoiceType, { rate: number; pitch: number }> = {
      majood: { rate: 0.7, pitch: 1.0 },
      muhdar: { rate: 0.9, pitch: 1.0 },
      ameeq: { rate: 0.6, pitch: 0.8 },
      moalima: { rate: 0.85, pitch: 1.2 },
      waqoor: { rate: 0.75, pitch: 0.9 },
    };

    const config = voiceConfig[selectedVoice];
    utterance.rate = config.rate;
    utterance.pitch = config.pitch;

    // Try to find an Arabic voice
    const voices = window.speechSynthesis.getVoices();
    const arabicVoice = voices.find((v) => v.lang.startsWith('ar'));
    if (arabicVoice) utterance.voice = arabicVoice;

    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setIsPlaying(true);
  };

  const savePreference = () => {
    localStorage.setItem(STORAGE_KEY, selectedVoice);
    setSavedPref(true);
    setTimeout(() => setSavedPref(false), 2000);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={playTTS}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg transition-smooth ${
          isPlaying
            ? 'bg-emerald-600 text-white'
            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
        }`}
      >
        {isPlaying ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        {isPlaying ? 'إيقاف' : 'استماع'}
      </button>

      <button
        onClick={() => setShowSettings(!showSettings)}
        className="p-1.5 text-accent-500 hover:bg-gray-100 rounded-lg transition-smooth"
      >
        <Settings2 className="w-4 h-4" />
      </button>

      {showSettings && (
        <div className="absolute z-30 mt-2 bg-white rounded-xl shadow-xl border border-gray-200 p-3 min-w-[200px] animate-slide-up"
          style={{ top: '100%', right: 0 }}>
          <p className="text-xs font-bold text-accent-700 mb-2">اختيار الصوت</p>
          <div className="space-y-1">
            <div className="mb-2">
              <p className="text-[10px] text-accent-600 mb-1">أصوات رجالية</p>
              {VOICE_OPTIONS.filter((v) => v.gender === 'male').map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVoice(v.id)}
                  className={`w-full text-right px-2 py-1.5 text-xs rounded-lg transition-smooth ${
                    selectedVoice === v.id ? 'bg-emerald-100 text-emerald-700 font-semibold' : 'hover:bg-gray-50 text-accent-600'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className="mb-2">
              <p className="text-[10px] text-accent-600 mb-1">أصوات نسائية</p>
              {VOICE_OPTIONS.filter((v) => v.gender === 'female').map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVoice(v.id)}
                  className={`w-full text-right px-2 py-1.5 text-xs rounded-lg transition-smooth ${
                    selectedVoice === v.id ? 'bg-emerald-100 text-emerald-700 font-semibold' : 'hover:bg-gray-50 text-accent-600'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={savePreference}
            className="w-full mt-2 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-smooth"
          >
            {savedPref ? 'تم الحفظ!' : 'حفظ التفضيل'}
          </button>
        </div>
      )}
    </div>
  );
}
