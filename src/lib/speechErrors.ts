// Plain-Arabic reasons for browser SpeechRecognition errors (2026-11-14).
// The voice assistant and the search mic used to swallow every error except
// "not allowed", so a dead mic just looked like "listening, hears nothing".
export type SpeechErr = { text: string; fatal: boolean } | null;

export function speechErrorMessage(code: string | undefined): SpeechErr {
  switch (code) {
    case 'not-allowed':
      return { text: 'المايك مش مسموح للمتصفح — اسمح بيه من إعدادات الجهاز (Safari ← الميكروفون)', fatal: true };
    case 'service-not-allowed':
      return { text: 'خدمة التعرّف على الصوت مقفولة — فعّل «الإملاء» من إعدادات الجهاز ← عام ← لوحة المفاتيح', fatal: true };
    case 'audio-capture':
      return { text: 'المايك مشغول بتطبيق تاني (مكالمة أو تسجيل شاشة) أو مش شغال — اقفل التطبيق التاني وجرّب', fatal: true };
    case 'language-not-supported':
      return { text: 'العربية مش متاحة للتعرّف على الصوت على الجهاز ده', fatal: true };
    case 'network':
      return { text: 'التعرّف على الصوت محتاج إنترنت — جرّب من غير VPN أو غيّر الشبكة', fatal: false };
    default:
      return null; // no-speech / aborted: normal, stay quiet
  }
}
