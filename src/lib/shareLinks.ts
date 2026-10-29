// Share deep links + hash parsing (STREAM S2, device-review fix batch).
//
// URL FORMAT (chosen; see EVIDENCE.md for the flagged alternative):
//   Ayah share (what ShareButton emits):
//     https://rawabit-alziker-alhakim.vercel.app/#/mushaf?surah=2&ayah=255
//   Page share (supported by the parser; no page-share button exists yet):
//     https://rawabit-alziker-alhakim.vercel.app/#/mushaf?page=5
//   Bare `#/mushaf` keeps working exactly as before.
// The ayah form is primary because surah/ayah is edition-independent,
// while a Madinah page number is not. The Mushaf resolves an ayah to its
// page through the same surah page list لوحتي jumps already use, falling
// back to the surah's first page if that list cannot load.
//
// HASH PARSER CONTRACT (stream S6 consumes this — keep it stable):
//   parseHash(hash) -> ParsedHash
//     - Accepts a full location.hash ('#/mushaf?surah=2&ayah=255',
//       '#mushaf', '#/mushaf?page=5', '') — never throws.
//     - `route` is one of the app's known routes. An UNKNOWN path does
//       NOT silently become a route: it returns route 'home' WITH
//       `unknown: true` and the raw hash preserved, so the caller can
//       decide (redirect, notice, log) instead of the old behaviour,
//       where any unrecognised fragment collapsed to home invisibly.
//     - Query params are validated, not trusted: page must be 1..604,
//       surah 1..114, ayah a positive integer; invalid values are
//       dropped (undefined), never clamped into a wrong ayah.
//     - A page param wins over surah/ayah when both are present, because
//       it is the more specific target.
//   buildShareUrl({ surah, ayah, page }) -> string
//     - Builds the shareable URL for one ayah (preferred), one page, or
//       the bare app URL when no target is given.

export const APP_URL = 'https://rawabit-alziker-alhakim.vercel.app';

export const TOTAL_MUSHAF_PAGES = 604;
export const TOTAL_SURAHS = 114;

export type AppRoute =
  | 'home'
  | 'admin'
  | 'app'
  | 'auth'
  | 'mushaf'
  | 'settings'
  | 'follow'
  | 'test'
  | 'listen';

export interface ParsedHash {
  route: AppRoute;
  /** Validated Madinah page number (1..604), when present. */
  page?: number;
  /** Validated surah number (1..114), when present. */
  surah?: number;
  /** Validated ayah number (positive integer), when present. */
  ayah?: number;
  /** True when the hash path was not a known route. `route` is 'home'
      in that case, but callers must not treat it as an intentional home
      navigation — the raw hash is preserved for that decision. */
  unknown: boolean;
  /** The hash exactly as received (including any leading '#'). */
  raw: string;
}

const KNOWN_ROUTES: AppRoute[] = [
  'admin',
  'app',
  'auth',
  'mushaf',
  'follow',
  'test',
  'settings',
  'listen',
];

function parsePositiveInt(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function parseHash(hash: string): ParsedHash {
  const raw = hash || '';
  const stripped = raw.startsWith('#') ? raw.slice(1) : raw;
  const [pathPart, queryPart] = stripped.split('?');
  const path = pathPart.replace(/^\//, '').replace(/\/$/, '');
  const params = new URLSearchParams(queryPart || '');

  const page = parsePositiveInt(params.get('page'));
  const surah = parsePositiveInt(params.get('surah'));
  const ayah = parsePositiveInt(params.get('ayah'));

  const parsed: ParsedHash = {
    route: 'home',
    unknown: false,
    raw,
  };
  if (page !== undefined && page <= TOTAL_MUSHAF_PAGES) parsed.page = page;
  if (surah !== undefined && surah <= TOTAL_SURAHS) parsed.surah = surah;
  if (ayah !== undefined) parsed.ayah = ayah;

  if (path === '' || path === 'home') return parsed;
  if ((KNOWN_ROUTES as string[]).includes(path)) {
    parsed.route = path as AppRoute;
    return parsed;
  }
  // Unknown path: fall back to home for rendering, but say so.
  parsed.unknown = true;
  return parsed;
}

export function buildShareUrl(target: {
  surah?: number;
  ayah?: number;
  page?: number;
}): string {
  const { surah, ayah, page } = target;
  if (
    page !== undefined &&
    Number.isInteger(page) &&
    page >= 1 &&
    page <= TOTAL_MUSHAF_PAGES
  ) {
    return `${APP_URL}/#/mushaf?page=${page}`;
  }
  if (
    surah !== undefined &&
    ayah !== undefined &&
    Number.isInteger(surah) &&
    surah >= 1 &&
    surah <= TOTAL_SURAHS &&
    Number.isInteger(ayah) &&
    ayah >= 1
  ) {
    return `${APP_URL}/#/mushaf?surah=${surah}&ayah=${ayah}`;
  }
  return APP_URL;
}
