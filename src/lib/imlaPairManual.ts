// Hand-added IMLA_PAIR_ALT entries (2026-11-26, phase 2 follow-up to 16.11, Dr. Amr: «fix»).
// The live quran_verses text (IndoPak) splits these words in two where the printed page
// shows ONE word (mostly the in-word iqlab space «نۭۡ ب»). The generated table in
// imlaAlt.ts already covered the other split words of the 84 affected ayat; these 13 were
// missing, so a correct recitation of e.g. «لينبذن» (104:4) was graded as two words.
// Keys = the two IndoPak tokens after expectedWordList; values = the spoken (imla'i) word,
// normalized the same way. Merged into IMLA_PAIR_ALT in imlaAlt.ts (keep this file when
// the generated table is rebuilt). Checked by imlaPairManual.test.ts.
export const IMLA_PAIR_ALT_MANUAL: Record<string, string[]> = {
  'ان بيهم': ['انبيهم'],       // 2:33  «اَنۭۡ بِئۡهُمۡ» = أنبئهم
  'ال ياسين': ['الياسين'],     // 37:130 «اِلۡ يَاسِيۡنَ» = إلياسين
  'ذن به': ['ذنبه'],           // 55:39 «ذَنۭۡ بِهٖ»
  'من بثا': ['منبثا'],         // 56:6  «مُّنۭۡ بَثًّا»
  'و تشتكي': ['وتشتكي'],       // 58:1  «وَ تَشۡتَكِيۡ»
  'ما نعتهم': ['مانعتهم'],     // 59:2  «مَّا نِعَتُهُمۡ»
  'ان باك': ['انباك'],         // 66:3  «اَنۭۡ بَاَكَ» = أنبأك
  'بذن بهم': ['بذنبهم'],       // 67:11, 91:14 «بِذَنۭۡ بِهِمۡ»
  'ان بتكم': ['انبتكم'],       // 71:17 «اَنۭۡ بَتَكُمۡ»
  'وان لو': ['والو'],          // 72:16 «وَّاَنۡ لَّوِ» = وألّو (one word on the page)
  'و لانعامكم': ['ولانعامكم'], // 79:33 «وَ لِاَنۡعَامِكُمۡ»
  'ان بعث': ['انبعث'],         // 91:12 «انۭۡ بَعَثَ»
  'لين بذن': ['لينبذن'],       // 104:4 «لَيُنۭۡ بَذَنَّ»
};
