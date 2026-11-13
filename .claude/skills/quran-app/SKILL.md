---
name: quran-app
description: Owner-decided rules for the Quran memorization app (احفظ القرآن بالتربيطات / روابط الذكر الحكيم). Read before ANY Quran app work — design, privacy + voice, and quality rules that must never be broken without asking the owner.
---

# Quran App — rules for Claude Code

App: "احفظ القرآن بالتربيطات" (روابط الذكر الحكيم). React 18 + TypeScript + Vite + Tailwind. Repo: AmrTaha71/quran-app (main, public). Supabase project ref: xfhjlukkvjzlmrggvowm. Live: https://rawabit-alziker-alhakim.vercel.app. Free, no ads, no money.

Read this file before any Quran app work. These rules are decided by the owner and do not change unless he says so. If a request conflicts with a rule, ask the owner before breaking it.

## Design (never break)
- [ ] Colors: emerald + gold only. No new colors.
- [ ] Mushaf page image: NEVER crop, move, scale, or distort it. Tap alignment depends on it.
- [ ] Mushaf slide: 300ms ease-out. Never change the easing or the duration.
- [ ] Night mode is BACKGROUND-ONLY. No dimming overlay over the Mushaf page itself.
- [ ] RTL layout. UI default language is ar-EG (Egyptian Arabic).
- [ ] BottomNav right-to-left: الرئيسية، لوحتي، المصحف، الحق الإمام، الإعدادات.

## Privacy + voice (never break)
- [ ] Rana's name NEVER appears on user-facing surfaces. Use 'صوت نسائي' / 'صوت رجالي' / 'المقطع الأصلي' (vs 'صوت مولّد' for synthetic). Her name only in admin flows.
- [ ] Voice policy: male users hear generated male voice; female users hear the original recording or generated female voice. Both generated voices must be EXTREMELY human.
- [ ] Synthetic generation source = ORIGINAL words by default. Never AI rephrase unless she explicitly edited.

## Quality
- [ ] Audio quality is the top priority, above the number of reciter options.
- [ ] Every push must be render-verified in a real browser before going out. Build success is not verification.
- [ ] After a push: wait for the Vercel build, then close the Safari tab completely and reopen fresh (never just reload). "Nothing worked" = stale tab first.
- [ ] Steps inside the Quran app are in Arabic; steps in any other app/service are in English.
- [ ] Self-test is the top priority. Never claim tajwid grading (madd/ghunna) — word-matching cannot check it.
