// 3.25 (2026-11-26): ONE reading of the stored tasmee' level, shared by the
// test page and the round tests (they had two copies of the same mapping).
// Stored ids stay English ('beginner' | 'advanced'); old / Arabic values map
// quietly: 'master' / «متقن» and 'intermediate' / «متوسط» read as advanced.
export type VerifyLevel = 'beginner' | 'advanced';
export function normalizeVerifyLevel(v: unknown): VerifyLevel {
  if (v === 'master' || v === 'متقن') return 'advanced';
  if (v === 'advanced' || v === 'intermediate' || v === 'متقدم' || v === 'متوسط') return 'advanced';
  return 'beginner';
}
