# مشروع: روابط الذكر الحكيم
## دليل شامل لنقل المشروع لأي AI آخر

---

## 1. نظرة عامة

منصة ويب لإدارة وفهرسة ٦٢٣٦ آية قرآنية مع نظام روابط تعليمية يساعد على الحفظ. يتضمن لوحة إدارة للمشرفين وتطبيقاً للمستخدمين، مع تكامل صوتي وذكاء اصطناعي.

**اسم التطبيق:** روابط الذكر الحكيم
**التاريخ:** 2026-10-10
**الحالة:** يعمل ويبني بنجاح، يحتاج إضافة مفاتيح Azure و OpenAI

---

## 2. التقنيات

| التقنية | الاستخدام |
|---------|-----------|
| React + TypeScript | الواجهة الأمامية |
| Vite | خادم التطوير والبناء |
| Tailwind CSS | التنسيق والتصميم |
| Supabase | قاعدة البيانات + المصادقة + التخزين + الدوال السحابية |
| OpenAI API | تحويل الصوت لنص (Whisper)، إعادة الصياغة (GPT-4o)، الصوت (TTS) |
| Azure TTS | تحويل النص لصوت عربي طبيعي (مدمج، يحتاج مفاتيح) |
| lucide-react | الأيقونات |

---

## 3. هيكل الملفات (محدّث)

```
project/
├── src/
│   ├── App.tsx                          # التوجيه (hash-based routing) — 5 مسارات
│   ├── main.tsx                         # نقطة الدخول
│   ├── index.css                        # الأنماط العامة
│   ├── components/
│   │   ├── CircularProgressIndicator.tsx
│   │   ├── EditVerseModal.tsx
│   │   ├── LinkModal.tsx                 # نافذة تسجيل رابط (تسجيل صوتي + AI)
│   │   ├── ProgressWidget.tsx
│   │   ├── QRCodeSection.tsx
│   │   ├── ShareButton.tsx
│   │   ├── SmartRephraseBox.tsx
│   │   ├── SplashScreen.tsx
│   │   ├── UserLists.tsx
│   │   └── VoiceSelector.tsx
│   ├── lib/
│   │   ├── auth.ts
│   │   ├── LanguageContext.tsx
│   │   ├── supabase.ts
│   │   ├── surahs.ts                     # قائمة السور الـ١١٤
│   │   ├── translations.ts              # 8 لغات
│   │   └── types.ts                      # الأنواع + ثوابت أنواع الربط
│   └── pages/
│       ├── AdminLogin.tsx
│       ├── AdminPage.tsx                 # لوحة الإدارة + سهم "من هنا يا رنا"
│       ├── AuthPage.tsx
│       ├── LandingPage.tsx               # الصفحة الرئيسية + زر المصحف
│       ├── QuranMushafPage.tsx           # صفحة المصحف الشريف (604 صفحة، 4 طبعات)
│       └── UserAppPage.tsx               # تطبيق المستخدم
├── supabase/
│   ├── config.toml                       # 4 دوال سحابية
│   ├── functions/
│   │   ├── generate-voice/index.ts       # Azure TTS + OpenAI TTS
│   │   ├── seed-quran/index.ts           # زرع 6236 آية
│   │   ├── smart-rephrase/index.ts       # GPT-4o
│   │   └── transcribe-audio/index.ts     # Whisper
│   └── migrations/
│       └── (8 ملفات SQL — آخرها: add_ayah_text_clean_for_search)
├── package.json
├── tailwind.config.js                    # يحتوي animation: bounce-slow
└── .env
```

---

## 4. قاعدة البيانات (Supabase)

### الجداول:

#### `quran_verses` — آيات القرآن (6236 آية)
- `id` (int, PK)
- `surah_no` (int), `surah_name` (text), `ayah_no` (int)
- `ayah_text` (text) — نص الآية بتشكيل كامل
- `ayah_text_clean` (text, GENERATED) — نص بدون تشكيل للبحث
- `has_links` (bool), `links_count` (int), `is_protected` (bool)
- `created_at`, `updated_at`

#### `ayah_links` — روابط الآيات
- `id`, `verse_id` (FK), `link_types` (text[]), `link_content` (text)
- `link_title`, `audio_url`, `synthetic_audio_url`, `voice_type`
- `original_transcript`, `status` (pending/approved/rejected)
- `rephrase_command`, `created_by`, `created_at`

#### `user_lists` — قوائم المستخدم
- `user_id`, `verse_id`, `list_type` (favorites/read_later/difficult)

### أنواع الربط (9 أنواع):
`wajih` (وجه), `sifa` (صفة), `mutashabihat` (متشابهات), `sabab_nuzul` (سبب نزول), `fawaaid` (فوائد), `lafdhi` (لفظي), `adadi` (عددي), `maqam` (مقام), `takrir` (تكرار)

### RLS:
- `quran_verses`: قراءة عامة (anon + authenticated)
- `ayah_links`: قراءة عامة للموافق عليها، كتابة للمصادقين
- `user_lists`: ملكية فردية (auth.uid = user_id)

### التخزين:
- Bucket: `rana-audio` (عام)

---

## 5. الدوال السحابية (Edge Functions)

جميع الدوال منشورة وتعمل (4 دوال):

| الدالة | الوظيفة | المفاتيح المطلوبة |
|--------|---------|-------------------|
| `seed-quran` | زرع 6236 آية | لا يحتاج |
| `smart-rephrase` | إعادة صياغة بـ GPT-4o | `OPENAI_API_KEY` |
| `transcribe-audio` | تحويل صوت لنص بـ Whisper | `OPENAI_API_KEY` |
| `generate-voice` | توليد صوت (Azure أولوية، OpenAI احتياطي) | `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` و/أو `OPENAI_API_KEY` |

### المفاتيح الحالية في Supabase Secrets:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`

### مفاتيح تحتاج إضافتها (مهم!):
1. `OPENAI_API_KEY` — احصل عليه من https://platform.openai.com/api-keys
2. `AZURE_SPEECH_KEY` — احصل عليه من https://portal.azure.com (أنشئ Speech Service)
3. `AZURE_SPEECH_REGION` — مثل `eastus` أو `westeurope`

### كيفية إضافة المفاتيح:
- عبر Supabase Dashboard → Edge Functions → Secrets
- أو عبر Supabase MCP tool: `supabase.functions.updateSecret({ name, value })`

---

## 6. الصفحات والميزات

### 6.1 الصفحة الرئيسية (LandingPage)
- شاشة بداية (SplashScreen) عند التحميل الأول
- عرض تقدم الفهرسة (آيات مفهرسة / 6236)
- مؤشر دائري للنسبة المئوية
- 8 لغات (عربي، إنجليزي، فرنسي، أردو، تركي، فارسي، إندونيسي، بنغالي)
- أزرار: تطبيق المستخدم، المصحف الشريف، لوحة الإدارة
- المشاركة ورمز QR

### 6.2 لوحة الإدارة (AdminPage)
- لوحة معلومات: إحصائيات (مفهرسة / غير مفهرسة / متبقية)
- **سهم "من هنا يا رنا"** المتحرك يشير لأول آية غير مفهرسة
- البحث: بالنص (٣ كلمات على الأقل)، رقم الآية، أو صيغة "سورة:آية" (مثل 2:255)
- تأخير 500ms على بحث النص (debounce)
- فلترة بالسورة / الحالة (أخضر/أحمر/الكل)
- تصدير Excel (CSV)
- زر "سجلي هنا يا رنا" لكل آية
- مراجعة الروابط المعلقة: قبول/رفض/تعديل/توليد صوت/إعادة صياغة

### 6.3 تطبيق المستخدم (UserAppPage)
- عرض الآيات المفهرسة فقط (has_links = true)
- البحث بنفس منطق لوحة الإدارة (٣ كلمات + debounce)
- قوائم: المفضلة / قراءة لاحقاً / صعبة
- استماع للآية (Browser Speech Synthesis — 5 أصوات)
- عرض الروابط لكل آية + استماع للصوت المخلّق
- ضغطة طويلة على الآية/الرابط للقوائم
- زر المشاركة ورمز QR
- أداة تقدم شخصية
- زر للانتقال لصفحة المصحف

### 6.4 صفحة المصحف الشريف (QuranMushafPage) — جديدة!
- تصفح 604 صفحة من المصحف بصور عالية الجودة
- 4 طبعات: المدينة المنورة، العثماني، التجويد الملون، ورش
- تكبير/تصغير + عرض ملء الشاشة
- الانتقال لأي صفحة أو سورة
- أزرار انتقال سريع (الفاتحة، آية الكرسي، جزء عمّ، جزء تبارك، الكهف)
- عرض الآيات المفهرسة في السورة الحالية
- مصادر الصور:
  - المدينة: `https://www.hquran.com/quran-pages/{page}.png`
  - أخرى: `https://quran.ksu.edu.sa/ayat/?size=800&ch=&id={page}&type={type}`

### 6.5 صفحة المصادقة (AuthPage)
- تسجيل دخول / إنشاء حساب (بريد + كلمة مرور)
- تأكيد تلقائي للمستخدمين الجدد

---

## 7. التغييرات الأخيرة (هذه الجلسة)

1. **إصلاح البحث بالنص:** إضافة عمود `ayah_text_clean` (generated) يخزن النص بدون تشكيل، مما يسمح بالبحث بـ "الرحمن" وإيجاد "الرَّحۡمٰنِ"
2. **تحسين البحث:** إضافة debounce (500ms) + شرط ٣ كلمات على الأقل للبحث النصي + رسالة تنبيه
3. **دعم صيغة "سورة:آية":** البحث بـ "2:255" يذهب مباشرة لآية الكرسي
4. **صفحة المصحف الشريف:** صفحة جديدة كاملة (QuranMushafPage.tsx) مع 4 طبعات وتصفح 604 صفحة
5. **سهم "من هنا يا رنا":** سهم متحرك ذهبي في لوحة الإدارة يشير لأول آية غير مفهرسة
6. **تحديث tailwind.config.js:** إضافة `bounce-slow` animation

---

## 8. مشاكل معروفة وأشياء تحتاج إصلاحاً

### يجب إصلاحه:
1. **مفاتيح Azure غير مضافة:** دالة `generate-voice` جاهزة لكنها ستحتاج OpenAI كاحتياطي حتى تتم إضافة `AZURE_SPEECH_KEY` و `AZURE_SPEECH_REGION`
2. **مفتاح OpenAI غير مضاف:** دالتا `smart-rephrase` و `transcribe-audio` تحتاجانه
3. **LinkModal.tsx السطر 26:** `useState<string[]>(['wajih'])` — القيمة الافتراضية صحيحة الآن (تم إصلاحها من `hifz`)

### تحسينات مقترحة:
1. استبدال Browser Speech Synthesis في VoiceSelector بـ Azure TTS
2. البحث في نصوص الروابط وليس فقط نصوص الآيات
3. إحصائيات تفصيلية للمستخدم
4. وضع ليلي (Dark Mode)
5. PWA للعمل دون اتصال
6. تحسين مصادر صور المصحف (بعض الطبعات قد لا تحمل من KSU)

---

## 9. كيفية استكمال المشروع على AI آخر

### الخطوة 1: انسخ المشروع
انسخ كل الملفات من المسارات المذكورة أعلاه. المشروع يستخدم Vite + React + TypeScript + Tailwind.

### الخطوة 2: ثبّت الحزم
```bash
npm install
```

### الخطوة 3: تأكد من .env
الملف `.env` يحتوي على:
```
VITE_SUPABASE_URL=https://dnzanhxoorelvgjjjuyk.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
هذه المفاتيح مرتبطة بمشروع Supabase مُفعّل. لا تغيّرها.

### الخطوة 4: أضف المفاتيح الناقصة في Supabase
أضف هذه الـ secrets عبر Supabase Dashboard أو MCP:
- `OPENAI_API_KEY` — من https://platform.openai.com/api-keys
- `AZURE_SPEECH_KEY` — من https://portal.azure.com (Speech Service)
- `AZURE_SPEECH_REGION` — مثل `eastus`

### الخطوة 5: ابنِ المشروع للتحقق
```bash
npm run build
```
إذا نجح البناء بدون أخطاء، المشروع سليم.

### الخطوة 6: (اختياري) أعد زرع آيات القرآن
إذا كانت قاعدة البيانات جديدة، شغّل دالة `seed-quran`:
```bash
curl -X POST https://dnzanhxoorelvgjjjuyk.supabase.co/functions/v1/seed-quran \
  -H "Authorization: Bearer <ANON_KEY>"
```
أو عبر Supabase Dashboard → Edge Functions → seed-quran → Invoke.

### الخطوة 7: للنشر
المشروع جاهز للنشر على أي منصة تدعم Vite + React. Supabase يعمل كخلفية مستضافة.

---

## 10. معلومات Supabase

- **Project URL:** https://dnzanhxoorelvgjjjuyk.supabase.co
- **Project ID:** dnzanhxoorelvgjjjuyk
- **Dashboard:** https://supabase.com/dashboard/project/dnzanhxoorelvgjjjuyk
- **Edge Functions URL pattern:** `https://dnzanhxoorelvgjjjuyk.supabase.co/functions/v1/{slug}`

### الدوال المنشورة (4):
1. `seed-quran` — زرع الآيات
2. `smart-rephrase` — إعادة الصياغة (GPT-4o)
3. `transcribe-audio` — تحويل الصوت لنص (Whisper)
4. `generate-voice` — توليد الصوت (Azure + OpenAI)

### المهاجرات (8 ملفات SQL):
1. `create_quran_indexing_schema` — الجداول الأساسية + RLS
2. `add_user_profiles_lists_and_link_types` — قوائم المستخدم
3. `auto_confirm_users_on_signup` — تأكيد تلقائي
4. `rename_link_url_to_link_content` — إعادة تسمية عمود
5. `add_multi_type_audio_and_review_workflow` — مصفوفة أنواع + نظام مراجعة
6. `add_synthetic_audio_and_voice_type` — صوت مخلّق
7. `update_link_types_to_memorization_categories` — 9 أنواع حفظ
8. `add_ayah_text_clean_for_search` — عمود بحث بدون تشكيل

---

## 11. الكود المفتاح (للرجوع السريع)

### ملف التوجيه (App.tsx):
5 مسارات: `home`, `admin`, `app`, `auth`, `mushaf`
- `#/` → LandingPage
- `#/admin` → AdminPage
- `#/app` → UserAppPage
- `#/mushaf` → QuranMushafPage
- `#/auth` → AuthPage

### أنواع الربط (types.ts):
```typescript
export const LINK_TYPES = [
  { value: 'wajih', label: 'وجه' },
  { value: 'sifa', label: 'صفة' },
  { value: 'mutashabihat', label: 'متشابهات' },
  { value: 'sabab_nuzul', label: 'سبب نزول' },
  { value: 'fawaaid', label: 'فوائد' },
  { value: 'lafdhi', label: 'لفظي' },
  { value: 'adadi', label: 'عددي' },
  { value: 'maqam', label: 'مقام' },
  { value: 'takrir', label: 'تكرار' },
];
```

### منطق البحث (في AdminPage و UserAppPage):
- رقم خالص (مثل 255) → بحث بـ ayah_no/surah_no/id
- صيغة "سورة:آية" (مثل 2:255) → بحث مباشر
- نص → تنظيف التشكيل + شرط ٣ كلمات + debounce 500ms → بحث في `ayah_text_clean`

### مصادر صور المصحف (QuranMushafPage.tsx):
```typescript
// المدينة المنورة
imageUrl: (page) => `https://www.hquran.com/quran-pages/${page}.png`
// العثماني / التجويد / ورش
imageUrl: (page) => `https://quran.ksu.edu.sa/ayat/?size=800&ch=&id=${page}&type=${type}`
```

### أصوات Azure (generate-voice/index.ts):
- `ar-SA-Hamed` (رجالي، سعودي)
- `ar-SA-Zariyah` (نسائي، سعودي)

### أصوات OpenAI (generate-voice/index.ts):
- `onyx` (رجالي), `nova` (نسائي)
- النموذج: `tts-1-hd`

---

## 12. روابط ومصادر

### APIs خارجية:
- **Quran API (للزرع):** `https://raw.githubusercontent.com/fawazahmed0/quran-api/1/editions/ara-quranindopak.json`
- **OpenAI API:** `https://api.openai.com/v1/`
- **Azure TTS:** `https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`

### الحصول على المفاتيح:
- **OpenAI:** https://platform.openai.com/api-keys
- **Azure Speech:** https://portal.azure.com → أنشئ Speech Service → انسخ Key 1 + Region
- **Azure TTS docs:** https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support

### Supabase:
- **Dashboard:** https://supabase.com/dashboard/project/dnzanhxoorelvgjjjuyk
- **Docs:** https://supabase.com/docs
- **Edge Functions:** https://supabase.com/docs/guides/functions

### مصادر صور المصحف:
- **المدينة المنورة:** https://www.hquran.com/quran-pages/
- **جامعة الملك سعود (عثماني/تجويد/ورش):** https://quran.ksu.edu.sa/ayat/

---

## 13. ملخص سريع

- المشروع **يعمل ويبني بنجاح** (`npm run build` ✓)
- **5 صفحات:** الرئيسية، المصادقة، لوحة الإدارة، تطبيق المستخدم، المصحف الشريف
- **4 دوال سحابية** منشورة في Supabase
- **8 مهاجرات** قاعدة بيانات مطبّقة
- **6236 آية** مزروعة في قاعدة البيانات
- **البحث يعمل** بالنص (٣ كلمات+) والرقم وصيغة سورة:آية
- **سهم "من هنا يا رنا"** يشير لأول آية غير مفهرسة
- **المصحف الشريف** بـ 4 طبعات و 604 صفحة
- **يحتاج فقط:** إضافة `OPENAI_API_KEY` و `AZURE_SPEECH_KEY` و `AZURE_SPEECH_REGION` في Supabase Secrets

---

*آخر تحديث: 2026-10-10*
