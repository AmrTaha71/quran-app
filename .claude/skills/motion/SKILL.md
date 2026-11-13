---
name: motion
description: Use Motion (formerly Framer Motion) for animations in the Quran memorization web app (React 18 + Vite + Tailwind). Use when adding motion, transitions, gestures, page transitions, or micro-interactions. Teaches the Motion API and the app's own animation rules.
---

# Motion — animation skill for the Quran app

Motion is the production animation library for React. Animations are declared as props on `motion.*` components. Install it once in the repo: `npm install motion`. Import from `motion/react` (NOT `framer-motion`).

## Core API
- `<motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} />` — entrance.
- `whileHover={{ scale: 1.03 }}` and `whileTap={{ scale: 0.97 }}` — press / hover feel.
- `transition={{ duration: 0.3, ease: "easeOut" }}` — timing. For a natural feel use springs: `transition={{ type: "spring", stiffness: 300, damping: 30 }}`.
- `<AnimatePresence>` around components that mount / unmount, with `exit={{ opacity: 0 }}` — exit animations.
- `layout` prop — auto-animates layout changes (size / position). `layoutId` — shared layout animation between two elements.
- `whileInView={{ opacity: 1, y: 0 }}` + `viewport={{ once: true }}` — scroll-triggered entrance.
- `useScroll()` / `useTransform()` — scroll-linked motion.

## Rules for THIS app (do not break these)
- NEVER change the Mushaf page slide (300ms ease-out) and NEVER crop, move, scale, or distort the Mushaf page image. Tap alignment depends on it.
- Palette is unified emerald + gold only. Motion must not introduce new colors.
- Animate transform and opacity ONLY (GPU). Do not animate width / height / margin — it janks and reflows the page.
- Keep motion fast and subtle: entrances 0.2–0.35s, presses instant. This is a memorization app — motion must never delay or distract from reading / reciting.
- Respect `prefers-reduced-motion`: if the user has reduced motion on, skip non-essential animation.
- Do not add motion to the Mushaf page image itself, or to ayah tap targets in a way that moves them.

## Patterns to prefer
- Buttons / cards: `whileTap={{ scale: 0.97 }}`; cards `whileHover={{ y: -2 }}`.
- Lists (mutashabihat, links): stagger children with `variants` + `staggerChildren: 0.05`.
- Page / route changes: `<AnimatePresence mode="wait">` with a 0.2s fade / slide — except the Mushaf slide, which stays 300ms ease-out and untouched.
- Toasts / banners: `initial={{ y: -16, opacity: 0 }}` → `animate` → `exit` on dismiss.

## Scope
- React WEB app only (the Quran app). Motion does NOT work in React Native — for حصن and ستر, use React Native Reanimated (a different library), not this skill.
