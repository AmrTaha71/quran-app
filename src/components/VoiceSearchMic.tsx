// Voice input for every search box in the app (2026-11-08).
// A floating mic appears beside whichever search field has focus; it
// lives in <body>, outside React's tree, so it never disturbs the
// page's own DOM. The heard text is written through the native value
// setter + an 'input' event, so React's onChange runs as if typed.
// A field joins when its placeholder looks like a search (بحث / ابحث /
// سورة / آية / search ...) or it has data-voice="on"; data-no-voice
// opts out (fields that already have their own mic).
import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';

const SEARCH_HINT = /بحث|ابحث|دوّر|دور|سور|آية|سمعتها|العلامة|search/i;

function isSearchField(el: Element | null): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.hasAttribute('data-no-voice')) return false;
  if (el.getAttribute('data-voice') === 'on') return true;
  if (el.type !== 'text' && el.type !== 'search') return false;
  return el.type === 'search' || SEARCH_HINT.test(el.placeholder || '');
}

function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export default function VoiceSearchMic() {
  const [target, setTarget] = useState<HTMLInputElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [listening, setListening] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supported = typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    if (!supported) return;
    const place = (el: HTMLInputElement) => {
      const r = el.getBoundingClientRect();
      // Inside the field's left edge (RTL text sits on the right).
      setPos({ top: r.top + r.height / 2 - 20, left: r.left + 4 });
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target as Element;
      if (!isSearchField(el)) return;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setTarget(el);
      place(el);
    };
    const onBlur = (e: FocusEvent) => {
      if (!isSearchField(e.target as Element)) return;
      // Short delay so a tap on the mic itself still lands.
      hideTimer.current = setTimeout(() => { setTarget(null); setPos(null); }, 250);
    };
    const onMove = () => { setTarget((t) => { if (t) place(t); return t; }); };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [supported]);

  const listen = (el: HTMLInputElement) => {
    const W = window as any;
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) return;
    try {
      const r = new Ctor();
      r.lang = 'ar-SA';
      r.interimResults = false;
      r.maxAlternatives = 1;
      r.onresult = (e: any) => {
        const t = String(e?.results?.[0]?.[0]?.transcript || '').trim();
        if (t) setNativeValue(el, t);
      };
      r.onend = () => { setListening(false); setTarget(null); setPos(null); };
      r.onerror = () => { setListening(false); };
      setListening(true);
      r.start();
    } catch {
      setListening(false);
    }
  };

  if (!supported || (!target && !listening) || !pos) return null;
  return (
    <button
      type="button"
      aria-label="ابحث بالصوت"
      // pointerdown + preventDefault keeps the field focused (no blur).
      onPointerDown={(e) => { e.preventDefault(); if (target && !listening) listen(target); }}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 2000 }}
      className={`w-10 h-10 rounded-lg flex items-center justify-center shadow ${listening ? 'bg-red-500 text-white animate-pulse' : 'bg-emerald-600 text-white'}`}
    >
      <Mic className="w-5 h-5" />
    </button>
  );
}
