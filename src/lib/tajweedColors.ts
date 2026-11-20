// Colours of the digital Mushaf page (one place to change them). Display only: the rules come
// from public/tajweed/tajweed-mushaf-image.json as they are, nothing here classifies anything.
// First pick (2026-11-21), to be reviewed by Dr. Amr; the grey ones are "not pronounced" marks.
export const TAJWEED_INK = '#1b1b1b';

export type TajweedRuleStyle = { color: string; label: string };

export const TAJWEED_RULES: Record<string, TajweedRuleStyle> = {
  hamzat_wasl: { color: '#868e96', label: 'همزة الوصل' },
  lam_shamsiyyah: { color: '#868e96', label: 'اللام الشمسية' },
  silent: { color: '#adb5bd', label: 'حرف لا يُنطق' },
  madd_2: { color: '#e8590c', label: 'مدّ حركتين' },
  madd_246: { color: '#d9480f', label: 'مدّ عارض (٢ أو ٤ أو ٦)' },
  madd_munfasil: { color: '#c2255c', label: 'مدّ منفصل' },
  madd_muttasil: { color: '#e03131', label: 'مدّ متصل' },
  madd_6: { color: '#a61e4d', label: 'مدّ لازم (٦)' },
  ghunnah: { color: '#2f9e44', label: 'غنّة' },
  ikhfa: { color: '#1971c2', label: 'إخفاء' },
  ikhfa_shafawi: { color: '#4dabf7', label: 'إخفاء شفوي' },
  idghaam_ghunnah: { color: '#0b7285', label: 'إدغام بغنّة' },
  idghaam_no_ghunnah: { color: '#5f3dc4', label: 'إدغام بلا غنّة' },
  idghaam_shafawi: { color: '#7048e8', label: 'إدغام شفوي' },
  idghaam_mutajanisayn: { color: '#9c36b5', label: 'إدغام متجانسين' },
  idghaam_mutaqaribayn: { color: '#b197fc', label: 'إدغام متقاربين' },
  iqlab: { color: '#e64980', label: 'إقلاب' },
  qalqalah: { color: '#3b5bdb', label: 'قلقلة' },
};

export function ruleColor(rule: string | null): string {
  return (rule && TAJWEED_RULES[rule]?.color) || TAJWEED_INK;
}
