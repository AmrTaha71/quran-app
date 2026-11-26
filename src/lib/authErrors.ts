// 6.11 (2026-11-26): Supabase auth errors arrive in English. Show the
// user Arabic they can act on; unknown messages get a general line
// instead of raw English.
const MAP: [RegExp, string][] = [
  [/invalid login credentials|invalid.*(email|password)/i, 'اسم المستخدم أو الإيميل أو كلمة السر مش صح.'],
  [/email not confirmed/i, 'لسه ما أكدتش الإيميل — افتح رابط التأكيد اللي وصلك.'],
  [/already (registered|exists)|user already/i, 'الحساب ده موجود قبل كده — سجّل دخول بدل ما تعمل حساب جديد.'],
  [/rate|too many|limit/i, 'محاولات كتير ورا بعض — استنى دقيقة وجرّب تاني.'],
  [/password.*(at least|short|characters|weak)|weak password/i, 'كلمة السر قصيرة أو ضعيفة — خليها ٦ حروف أو أكتر.'],
  [/same.*password|different from the old/i, 'كلمة السر الجديدة لازم تختلف عن القديمة.'],
  [/session|jwt|expired|token/i, 'الرابط أو الجلسة خلصت — اطلب رابط جديد وجرّب تاني.'],
  [/invalid.*email|unable to validate email|email.*invalid/i, 'الإيميل مكتوب غلط — راجعه.'],
  [/signups? not allowed|signup.*disabled/i, 'التسجيل مقفول دلوقتي.'],
  [/network|fetch|failed to fetch|timeout/i, 'في مشكلة في الاتصال — اتأكد من النت وجرّب تاني.'],
];

export function authErrorAr(message: string | null | undefined): string {
  const m = (message ?? '').trim();
  if (!m) return 'حصلت مشكلة — جرّب تاني.';
  if (/[؀-ۿ]/.test(m)) return m; // already Arabic
  for (const [re, ar] of MAP) if (re.test(m)) return ar;
  return 'حصلت مشكلة في الدخول — جرّب تاني بعد شوية.';
}
