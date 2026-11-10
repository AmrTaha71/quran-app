// Tajwid skill selection for SelfTest (spec: claude/recitation-level-spec-2026-11-09.md).
// Pure logic only. Not yet wired into SelfTestPage.tsx.
// Tiers and the level rule are PROVISIONAL until Rana reviews them.

export type SkillTier = 'hafiz' | 'veryGood' | 'good' | 'beginner';
export type SkillLevel = SkillTier;

export interface TajwidSkill {
  id: string;
  label: string;
  tier: SkillTier;
}

export const TAJWID_SKILLS: readonly TajwidSkill[] = [
  // Hafiz (hardest)
  { id: 'madd_muttasil', label: 'المد المتصل', tier: 'hafiz' },
  { id: 'madd_lazim', label: 'المد اللازم', tier: 'hafiz' },
  { id: 'ikhfa', label: 'الإخفاء', tier: 'hafiz' },
  { id: 'tarqiq', label: 'الترقيق', tier: 'hafiz' },
  { id: 'tafkhim', label: 'التفخيم', tier: 'hafiz' },
  // Very good
  { id: 'madd_munfasil', label: 'المد المنفصل', tier: 'veryGood' },
  { id: 'ghunna', label: 'الغنة', tier: 'veryGood' },
  // Good
  { id: 'iqlab', label: 'الإقلاب', tier: 'good' },
  { id: 'qalqalah', label: 'القلقلة', tier: 'good' },
  // Beginner (basic rules, plus items the spec does not place yet)
  { id: 'idhar', label: 'الإظهار', tier: 'beginner' },
  { id: 'idgham', label: 'الإدغام', tier: 'beginner' },
  { id: 'ikhfa_shafawi', label: 'الإخفاء الشفوي', tier: 'beginner' },
  { id: 'idgham_shafawi', label: 'الإدغام الشفوي', tier: 'beginner' },
  { id: 'idhar_shafawi', label: 'الإظهار الشفوي', tier: 'beginner' },
  { id: 'madd_arid', label: 'المد العارض للسكون', tier: 'beginner' },
  { id: 'madd_badal', label: 'مد البدل', tier: 'beginner' },
  { id: 'madd_lawahiq', label: 'لواحق المد', tier: 'beginner' },
  { id: 'lam_mufakhama', label: 'اللام المفخمة', tier: 'beginner' },
  { id: 'lam_muraqqaa', label: 'اللام المرققة', tier: 'beginner' },
  { id: 'waqf', label: 'الوقف والابتداء', tier: 'beginner' },
];

const TIER_RANK: Record<SkillTier, number> = { beginner: 0, good: 1, veryGood: 2, hafiz: 3 };

const SKILL_BY_ID: Map<string, TajwidSkill> = new Map(TAJWID_SKILLS.map((s) => [s.id, s]));

export function getSkill(id: string): TajwidSkill | undefined {
  return SKILL_BY_ID.get(id);
}

// Keeps only known ids, removes duplicates. An empty result stays empty:
// the spec says the screen starts with nothing selected (no default).
export function sanitizeSkillSelection(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id === 'string' && SKILL_BY_ID.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

// PROVISIONAL rule: the level is the hardest tier among the selected skills.
// The spec also says the count of selected skills should matter; that rule
// is not decided yet (open question 2 for Rana), so it is not applied here.
export function levelForSelection(ids: string[]): SkillLevel | null {
  let best: SkillTier | null = null;
  for (const id of sanitizeSkillSelection(ids)) {
    const s = SKILL_BY_ID.get(id);
    if (!s) continue;
    if (best === null || TIER_RANK[s.tier] > TIER_RANK[best]) best = s.tier;
  }
  return best;
}

// Equal weights (spec default). Returns 0..100 rounded, or null when nothing is selected.
export function equalWeightScore(selected: string[], passedIds: string[]): number | null {
  const sel = sanitizeSkillSelection(selected);
  if (sel.length === 0) return null;
  const passed = sel.filter((id) => passedIds.includes(id)).length;
  return Math.round((passed / sel.length) * 100);
}

// Corrections only fire for selected skills. Anything else is dropped silently.
export function filterIssuesToSelection<T extends { skillId: string }>(selected: string[], issues: T[]): T[] {
  const sel = new Set(sanitizeSkillSelection(selected));
  return issues.filter((i) => sel.has(i.skillId));
}
