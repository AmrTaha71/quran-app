// Tajweed question bank (W4-G, 2026-11-19). STRUCTURE ONLY: the data file
// src/data/tajweed-bank.json holds 20 questions (W4-N) on agreed rulings only
// (no invented rulings, no disputed ones). It grows by appending items to that file;
// nothing here needs to change. EVERY item must be reviewed by Dr. Amr or a
// tajweed specialist before it is shown beyond the admin view: `reviewed`
// stays false until then. Admin-only in the UI (useIsAdminView).
import BANK from '../data/tajweed-bank.json';
import type { SkillTier } from './tajwidSkills';

export type TajweedQuestion = {
  id: string;
  skillId: string;
  tier: SkillTier;
  question: string;
  options: string[];
  /** index of the right option in `options` */
  correct: number;
  reviewed: boolean;
  /** one/two-line plain-Arabic explanation of the ruling (W4-N) */
  explanation?: string;
  /** reference ayah as "surah:ayah" and the quoted phrase (W4-N) */
  ref?: string;
  example?: string;
};

const RANK: Record<SkillTier, number> = { beginner: 0, good: 1, veryGood: 2, hafiz: 3 };

const ALL = BANK as TajweedQuestion[];

export function tajweedBankSize(): number { return ALL.length; }

/** Random questions up to the given level (a level includes the easier tiers),
 *  optionally only for the selected skills. Options come back shuffled. */
export function pickTajweedQuestions(count: number, level: SkillTier, skillIds: string[] = []): TajweedQuestion[] {
  const pool = ALL.filter((q) => RANK[q.tier] <= RANK[level] && (skillIds.length === 0 || skillIds.includes(q.skillId)));
  const out: TajweedQuestion[] = [];
  const left = [...pool];
  while (out.length < count && left.length > 0) {
    const q = left.splice(Math.floor(Math.random() * left.length), 1)[0];
    const order = q.options.map((_, i) => i).sort(() => Math.random() - 0.5);
    out.push({ ...q, options: order.map((i) => q.options[i]), correct: order.indexOf(q.correct) });
  }
  return out;
}
