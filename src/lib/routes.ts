// The ONE Route type for the whole app (wave 2, W2-1). Every page and
// component used to declare its own copy of this union (some of them
// missing 'listen'/'radio'/'room'); they now import it from here.
// shareLinks.ts parses `#/<route>` hashes against ALL_ROUTES, and App.tsx
// renders from it, so a new route is added in exactly this one place.
// Pure data: no React, no Supabase.

export const ALL_ROUTES = [
  'home',
  'admin',
  'app',
  'auth',
  'mushaf',
  'settings',
  'follow',
  'test',
  'listen',
  'adhkar',
  'radio',
  'room',
  'hifz',
  'quiz',
] as const;

export type Route = (typeof ALL_ROUTES)[number];
