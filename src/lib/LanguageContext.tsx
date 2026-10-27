import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { Lang } from './translations';
import { T } from './translations';

// Speech locale follows the chosen UI language: Egyptian dialect uses
// ar-EG recognition/TTS (better for Egyptian speech); everything else
// keeps the existing ar-SA behaviour.
export function speechLocale(lang: Lang): string {
  return lang === 'ar-EG' ? 'ar-EG' : 'ar-SA';
}

// Same as speechLocale, for components that don't use the lang context.
export function currentSpeechLocale(): string {
  return speechLocale((localStorage.getItem('app-lang') as Lang) || 'ar-EG');
}

type TK = keyof typeof T.ar;

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TK) => string;
  dir: 'rtl' | 'ltr';
}

const LanguageContext = createContext<LangCtx>({
  lang: 'ar-EG',
  setLang: () => {},
  t: (key) => T.ar[key],
  dir: 'rtl',
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('app-lang') as Lang;
    return saved || 'ar-EG';
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem('app-lang', l);
  };

  const dir: 'rtl' | 'ltr' = lang === 'en' || lang === 'fr' ? 'ltr' : 'rtl';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const t = (key: TK) => T[lang][key] || T.ar[key] || key;

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, dir }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  return useContext(LanguageContext);
}
