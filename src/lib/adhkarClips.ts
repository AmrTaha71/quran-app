// adhkarClips.ts — GENERATED from adhkar-full/manifest.json (2026-10-29).
// Do NOT hand-edit URLs: regenerate from the manifest. Real generated-voice
// clips (male = Amr's pick, voice 2; female = voice 1), one file per dhikr.
// Player repeats each clip `count` times (repeat-in-player rule); no clip
// itself contains repetitions. All URLs are public Supabase storage URLs
// (the same bucket the generate-voice function uploads to).
// EXCEPTION, hand-added 2026-10-29 (Amr's decision): the two Quranic
// items carry `quranic: true`. Regeneration MUST preserve those flags:
// the male voice plays them as REAL recitation via reciters.ts (see
// AdhkarPage segmentsFor), not from maleUrl; the female voice keeps
// the synthetic clip (no female reciter exists in the app's set).

export type AdhkarVoice = 'male' | 'female';
export type AdhkarWird = 'morning' | 'evening';

export interface AdhkarClip {
  id: string;
  /** Display text (unvocalized wording from the prep file). */
  display: string;
  /** Repetitions the player performs for this dhikr. */
  count: number;
  /** True for Quranic items (Kursi, the three surahs): the male voice
      plays real recitation (AdhkarPage segmentsFor); the female voice
      keeps the synthetic clip. Hand-added 2026-10-29 — preserve on regen. */
  quranic?: boolean;
  maleUrl: string;
  femaleUrl: string;
}

export const ADHKAR_CLIPS: Record<string, AdhkarClip> = {
  "kursi": { id: "kursi", display: "آية الكرسي (البقرة 255)", count: 1, quranic: true, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793302712906.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793302647642.mp3" },
  "surahs3": { id: "surahs3", display: "الإخلاص والفلق والناس", count: 3, quranic: true, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303252919.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303192717.mp3" },
  "asbahna": { id: "asbahna", display: "أصبحنا وأصبح الملك لله، والحمد لله، لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير، رب أسألك خير ما في هذا اليوم وخير ما بعده، وأعوذ بك من شر ما في هذا اليوم وشر ما بعده، رب أعوذ بك من الكسل وسوء الكبر، رب أعوذ بك من عذاب في النار وعذاب في القبر", count: 1, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303166664.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303340522.mp3" },
  "istighfar": { id: "istighfar", display: "سيد الاستغفار: اللهم أنت ربي لا إله إلا أنت، خلقتني وأنا عبدك، وأنا على عهدك ووعدك ما استطعت، أعوذ بك من شر ما صنعت، أبوء لك بنعمتك علي، وأبوء بذنبي فاغفر لي فإنه لا يغفر الذنوب إلا أنت", count: 1, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793302723064.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793302669040.mp3" },
  "raditu": { id: "raditu", display: "رضيت بالله ربًا، وبالإسلام دينًا، وبمحمد ﷺ نبيًا", count: 3, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303191690.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303200266.mp3" },
  "ashhadu-am": { id: "ashhadu-am", display: "اللهم إني أصبحت أشهدك، وأشهد حملة عرشك، وملائكتك، وجميع خلقك، أنك أنت الله لا إله إلا أنت وحدك لا شريك لك، وأن محمدًا عبدك ورسولك", count: 4, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303200631.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303208629.mp3" },
  "nima-am": { id: "nima-am", display: "اللهم ما أصبح بي من نعمة أو بأحد من خلقك فمنك وحدك لا شريك لك، فلك الحمد ولك الشكر", count: 1, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303208039.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303218383.mp3" },
  "hasbi": { id: "hasbi", display: "حسبي الله لا إله إلا هو، عليه توكلت، وهو رب العرش العظيم", count: 7, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303213595.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303219326.mp3" },
  "bismillah": { id: "bismillah", display: "بسم الله الذي لا يضر مع اسمه شيء في الأرض ولا في السماء وهو السميع العليم", count: 3, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303225454.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303227197.mp3" },
  "bika-am": { id: "bika-am", display: "اللهم بك أصبحنا، وبك أمسينا، وبك نحيا، وبك نموت، وإليك النشور", count: 1, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303233453.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303235712.mp3" },
  "fitra-am": { id: "fitra-am", display: "أصبحنا على فطرة الإسلام، وعلى كلمة الإخلاص، وعلى دين نبينا محمد ﷺ، وعلى ملة أبينا إبراهيم حنيفًا مسلمًا وما كان من المشركين", count: 1, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303241645.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303243362.mp3" },
  "subhan": { id: "subhan", display: "سبحان الله وبحمده", count: 100, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793302619853.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793302693019.mp3" },
  "lailaha": { id: "lailaha", display: "لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير", count: 100, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303258925.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303249833.mp3" },
  "subhan-count": { id: "subhan-count", display: "سبحان الله وبحمده عدد خلقه ورضا نفسه وزنة عرشه ومداد كلماته", count: 3, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303256078.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303260811.mp3" },
  "ilman": { id: "ilman", display: "اللهم إني أسألك علمًا نافعًا، ورزقًا طيبًا، وعملًا متقبلًا (صباح فقط)", count: 1, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303353191.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303353704.mp3" },
  "astaghfir": { id: "astaghfir", display: "أستغفر الله وأتوب إليه", count: 100, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303356450.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303358326.mp3" },
  "kalimat": { id: "kalimat", display: "أعوذ بكلمات الله التامات من شر ما خلق", count: 3, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303359454.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303361665.mp3" },
  "salli": { id: "salli", display: "اللهم صل وسلم على نبينا محمد", count: 10, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303366680.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303365222.mp3" },
  "amsayna": { id: "amsayna", display: "أمسينا وأمسى الملك لله، والحمد لله، لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير، رب أسألك خير ما في هذه الليلة وخير ما بعدها، وأعوذ بك من شر ما في هذه الليلة وشر ما بعدها، رب أعوذ بك من الكسل وسوء الكبر، رب أعوذ بك من عذاب في النار وعذاب في القبر", count: 1, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303378864.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303374980.mp3" },
  "ashhadu-pm": { id: "ashhadu-pm", display: "اللهم إني أمسيت أشهدك، وأشهد حملة عرشك، وملائكتك، وجميع خلقك، أنك أنت الله لا إله إلا أنت وحدك لا شريك لك، وأن محمدًا عبدك ورسولك", count: 4, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303374611.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303382517.mp3" },
  "nima-pm": { id: "nima-pm", display: "اللهم ما أمسى بي من نعمة أو بأحد من خلقك فمنك وحدك لا شريك لك، فلك الحمد ولك الشكر", count: 1, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303385170.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303385339.mp3" },
  "bika-pm": { id: "bika-pm", display: "اللهم بك أمسينا، وبك أصبحنا، وبك نحيا، وبك نموت، وإليك المصير", count: 1, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303391519.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303392762.mp3" },
  "fitra-pm": { id: "fitra-pm", display: "أمسينا على فطرة الإسلام، وعلى كلمة الإخلاص، وعلى دين نبينا محمد ﷺ، وعلى ملة أبينا إبراهيم حنيفًا مسلمًا وما كان من المشركين", count: 1, maleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303393746.mp3", femaleUrl: "https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/rana-audio/synthetic-1793303398555.mp3" },
};

export const ADHKAR_MORNING: string[] = ["kursi", "surahs3", "asbahna", "istighfar", "raditu", "ashhadu-am", "nima-am", "hasbi", "bismillah", "bika-am", "fitra-am", "subhan", "lailaha", "subhan-count", "ilman", "astaghfir", "kalimat", "salli"];
export const ADHKAR_EVENING: string[] = ["kursi", "surahs3", "amsayna", "istighfar", "raditu", "ashhadu-pm", "nima-pm", "hasbi", "bismillah", "bika-pm", "fitra-pm", "subhan", "lailaha", "subhan-count", "astaghfir", "kalimat", "salli"];

export function adhkarList(wird: AdhkarWird): AdhkarClip[] {
  return (wird === 'morning' ? ADHKAR_MORNING : ADHKAR_EVENING).map((id) => ADHKAR_CLIPS[id]);
}

export function adhkarClipUrl(clip: AdhkarClip, voice: AdhkarVoice): string {
  return voice === 'male' ? clip.maleUrl : clip.femaleUrl;
}
