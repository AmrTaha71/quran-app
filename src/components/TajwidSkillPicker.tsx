// Tajwid skill picker for the self-test settings (2026-11-10).
// Only the selection is saved. Correction and scoring per skill are NOT
// wired yet: the engine does not detect tajwid rules (it only sees missing,
// wrong or extra words), so the selection has no effect on results yet.
import { useState } from 'react';
import { TAJWID_SKILLS, sanitizeSkillSelection, type SkillTier } from '../lib/tajwidSkills';

export const TAJWID_SKILLS_KEY = 'quran-tajwid-skills-v1';

export function loadTajwidSkills(): string[] {
  try {
    return sanitizeSkillSelection(JSON.parse(localStorage.getItem(TAJWID_SKILLS_KEY) || '[]'));
  } catch { return []; }
}

function saveTajwidSkills(ids: string[]): void {
  try { localStorage.setItem(TAJWID_SKILLS_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

const TIER_TITLE: Record<SkillTier, string> = {
  hafiz: 'للحفظة',
  veryGood: 'جيد جداً',
  good: 'جيد',
  beginner: 'مبتدئ',
};
const TIER_ORDER: SkillTier[] = ['hafiz', 'veryGood', 'good', 'beginner'];

export default function TajwidSkillPicker() {
  const [selected, setSelected] = useState<string[]>(loadTajwidSkills);

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    const clean = sanitizeSkillSelection(next);
    setSelected(clean);
    saveTajwidSkills(clean);
  };

  return (
    <div className="col-span-2">
      <p className="text-xs font-medium text-accent-700 mb-1">أحكام التجويد اللي عايز تتسمّع عليها</p>
      <div className="space-y-2">
        {TIER_ORDER.map((tier) => (
          <div key={tier}>
            <p className="text-[11px] text-accent-600 mb-1">{TIER_TITLE[tier]}</p>
            <div className="flex flex-wrap gap-1.5">
              {TAJWID_SKILLS.filter((s) => s.tier === tier).map((s) => (
                <button key={s.id} onClick={() => toggle(s.id)} aria-pressed={selected.includes(s.id)}
                  className={`min-h-[36px] px-2 rounded-xl font-semibold text-xs polish-press ${selected.includes(s.id) ? 'grad-amber-door text-white' : 'bg-white border border-hairline text-accent-700'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-accent-600 mt-1">
        {selected.length === 0 ? 'ما اخترتش حاجة لحد دلوقتي.' : `اخترت ${selected.length} حكم. الاختيار ده محفوظ، والتصحيح حسبه لسه ما اتوصلش.`}
      </p>
    </div>
  );
}
