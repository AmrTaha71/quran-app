// تواصل معنا (2026-11-13): write the message, or dictate it with the mic
// (browser speech-to-text), then «إرسال» opens the device's mail app with
// the message ready. Temporary destination chosen by the owner.
import { useRef, useState } from 'react';
import { Mic, Send, Square } from 'lucide-react';

const CONTACT_TO = 'amrgabermousa@yahoo.com';

export default function ContactForm() {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState('');
  const recRef = useRef<any>(null);
  const baseRef = useRef('');

  const toggleMic = () => {
    if (listening) { try { recRef.current?.stop(); } catch { /* ignore */ } return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setNote('المتصفح ده مش بيدعم الإملاء بالصوت — اكتب الرسالة، أو استخدم ميكروفون الكيبورد.'); return; }
    const rec = new SR();
    rec.lang = 'ar-EG';
    rec.continuous = true;
    rec.interimResults = true;
    baseRef.current = text ? `${text.trim()} ` : '';
    rec.onresult = (e: any) => {
      let s = '';
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
      setText(baseRef.current + s);
    };
    rec.onerror = () => { setListening(false); setNote('الميكروفون ما اشتغلش — اتأكد من الإذن وجرب تاني.'); };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setNote('');
    try { rec.start(); setListening(true); } catch { setListening(false); }
  };

  const send = () => {
    const body = encodeURIComponent(text.trim());
    window.location.href = `mailto:${CONTACT_TO}?subject=${encodeURIComponent('رسالة من تطبيق تربيطات آيات القرآن')}&body=${body}`;
  };

  return (
    <div className="mt-4">
      <p className="font-semibold text-accent-800 mb-2">تواصل معنا</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="اكتب رسالتك هنا، أو دوس على الميكروفون وقولها…"
        className="w-full border border-hairline-emerald rounded-xl p-3 text-base bg-white" />
      {note && <p className="text-sm text-amber-700 mt-1">{note}</p>}
      <div className="grid grid-cols-2 gap-2 mt-2">
        <button onClick={toggleMic}
          className={`py-3 rounded-xl font-bold flex items-center justify-center gap-2 polish-press ${listening ? 'bg-rose-600 text-white' : 'bg-white border border-hairline-emerald text-accent-800'}`}>
          {listening ? <><Square className="w-5 h-5" /> وقّف التسجيل</> : <><Mic className="w-5 h-5" /> قولها بالميكروفون</>}
        </button>
        <button onClick={send} disabled={!text.trim()}
          className="py-3 rounded-xl font-bold flex items-center justify-center gap-2 grad-emerald-door text-white polish-press disabled:opacity-50">
          <Send className="w-5 h-5" /> إرسال
        </button>
      </div>
    </div>
  );
}
