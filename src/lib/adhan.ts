// Adhan prayer-time alerts — foreground only.
//
// Timings: AlAdhan API (free, no key, CORS *), by city+country or by
// GPS coordinates. Calculation method: Egypt → 5 (Egyptian General
// Authority), Saudi Arabia → 4 (Umm al-Qura); other countries and GPS
// use the API default, and the returned method name is shown in the
// UI so nothing is hidden.
//
// Audio: ONLY the open-licensed source the user picked — the Makkah
// adhan on Wikimedia Commons, CC BY (credit: Seyfula Islam),
// converted to MP3 and shipped in public/ with the credit in the UI.
// No other muezzin file is used. The takbir-only excerpt is NOT
// shipped: silence analysis found candidate pauses (~17s, ~35s) but
// no verified content boundary, and a guessed cut could truncate
// mid-phrase — it waits for a verified cut point.

export type AdhanAlertType = 'both' | 'audio';
export type AdhanSound = 'full' | 'beep';

export type AdhanLocation =
  | { kind: 'gps'; lat: number; lng: number; label: string }
  | { kind: 'manual'; country: string; countryName: string; city: string };

export interface AdhanSettings {
  enabled: boolean;
  location: AdhanLocation | null;
  alertType: AdhanAlertType;
  sound: AdhanSound;
}

export const ADHAN_SETTINGS_KEY = 'quran-adhan-settings';
export const ADHAN_DAY_KEY = 'quran-adhan-day';
export const ADHAN_FIRED_KEY = 'quran-adhan-fired';
// Hosted in the public `adhan` Storage bucket (push-files carries
// UTF-8 code only, so the MP3 cannot ride the repo push). The file
// itself is the Commons CC BY audio, converted to MP3, unmodified.
export const ADHAN_AUDIO_URL =
  'https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/adhan/makkah-adhan-ccby.mp3';
export const ADHAN_AUDIO_CREDIT =
  'أذان المسجد الحرام — ويكيميديا كومنز، ترخيص CC BY (Seyfula Islam)';

export const ADHAN_PRAYERS = [
  { key: 'Fajr', label: 'الفجر' },
  { key: 'Dhuhr', label: 'الظهر' },
  { key: 'Asr', label: 'العصر' },
  { key: 'Maghrib', label: 'المغرب' },
  { key: 'Isha', label: 'العشاء' },
] as const;

export type AdhanPrayerKey = (typeof ADHAN_PRAYERS)[number]['key'];

export interface AdhanDay {
  timings: Record<string, string>;
  timezone: string;
  methodName: string;
  hijri: string;
  dateKey: string; // YYYY-MM-DD in the location timezone
}

export interface AdhanCountry {
  code: string;
  name: string;
  api: string;
  method?: number;
}

// Country FIRST, then city — the order the user asked for. The city
// itself is typed (a full city database per country is out of V1).
export const ADHAN_COUNTRIES: AdhanCountry[] = [
  { code: 'EG', name: 'مصر', api: 'Egypt', method: 5 },
  { code: 'SA', name: 'السعودية', api: 'Saudi Arabia', method: 4 },
  { code: 'AE', name: 'الإمارات', api: 'United Arab Emirates' },
  { code: 'QA', name: 'قطر', api: 'Qatar' },
  { code: 'KW', name: 'الكويت', api: 'Kuwait' },
  { code: 'BH', name: 'البحرين', api: 'Bahrain' },
  { code: 'OM', name: 'عُمان', api: 'Oman' },
  { code: 'JO', name: 'الأردن', api: 'Jordan' },
  { code: 'PS', name: 'فلسطين', api: 'Palestine' },
  { code: 'LB', name: 'لبنان', api: 'Lebanon' },
  { code: 'SY', name: 'سوريا', api: 'Syria' },
  { code: 'IQ', name: 'العراق', api: 'Iraq' },
  { code: 'YE', name: 'اليمن', api: 'Yemen' },
  { code: 'LY', name: 'ليبيا', api: 'Libya' },
  { code: 'TN', name: 'تونس', api: 'Tunisia' },
  { code: 'DZ', name: 'الجزائر', api: 'Algeria' },
  { code: 'MA', name: 'المغرب', api: 'Morocco' },
  { code: 'SD', name: 'السودان', api: 'Sudan' },
  { code: 'TR', name: 'تركيا', api: 'Turkey' },
  { code: 'ID', name: 'إندونيسيا', api: 'Indonesia' },
  { code: 'MY', name: 'ماليزيا', api: 'Malaysia' },
  { code: 'PK', name: 'باكستان', api: 'Pakistan' },
  { code: 'IN', name: 'الهند', api: 'India' },
  { code: 'BD', name: 'بنغلاديش', api: 'Bangladesh' },
  { code: 'US', name: 'أمريكا', api: 'United States' },
  { code: 'GB', name: 'بريطانيا', api: 'United Kingdom' },
  { code: 'FR', name: 'فرنسا', api: 'France' },
  { code: 'DE', name: 'ألمانيا', api: 'Germany' },
  { code: 'CA', name: 'كندا', api: 'Canada' },
  { code: 'AU', name: 'أستراليا', api: 'Australia' },
];

export function defaultAdhanSettings(): AdhanSettings {
  return { enabled: false, location: null, alertType: 'both', sound: 'full' };
}

function validLocation(raw: unknown): AdhanLocation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'gps' && typeof r.lat === 'number' && typeof r.lng === 'number') {
    return { kind: 'gps', lat: r.lat, lng: r.lng, label: typeof r.label === 'string' ? r.label : 'موقعي الحالي' };
  }
  if (r.kind === 'manual' && typeof r.country === 'string' && typeof r.city === 'string') {
    return {
      kind: 'manual',
      country: r.country,
      countryName: typeof r.countryName === 'string' ? r.countryName : r.country,
      city: r.city,
    };
  }
  return null;
}

export function loadAdhanSettings(): AdhanSettings {
  try {
    const raw = localStorage.getItem(ADHAN_SETTINGS_KEY);
    if (!raw) return defaultAdhanSettings();
    const p = JSON.parse(raw) as Partial<AdhanSettings>;
    return {
      enabled: p.enabled === true,
      location: validLocation(p.location),
      alertType: p.alertType === 'audio' ? 'audio' : 'both',
      sound: p.sound === 'beep' ? 'beep' : 'full',
    };
  } catch {
    return defaultAdhanSettings();
  }
}

export function saveAdhanSettings(s: AdhanSettings): void {
  try {
    localStorage.setItem(ADHAN_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable — settings live only for this session.
  }
}

export function adhanLocationLabel(loc: AdhanLocation): string {
  return loc.kind === 'gps' ? loc.label : `${loc.city}، ${loc.countryName}`;
}

function adhanLocationKey(loc: AdhanLocation): string {
  return JSON.stringify(loc);
}

function toApiDate(dateKey: string): string {
  // YYYY-MM-DD → DD-MM-YYYY for AlAdhan.
  const [y, m, d] = dateKey.split('-');
  return `${d}-${m}-${y}`;
}

function deviceDateKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dateInTimezone(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return deviceDateKey();
  }
}

export function timeInTimezone(tz: string): string {
  try {
    const s = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
    return s.startsWith('24:') ? `00:${s.slice(3)}` : s;
  } catch {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function cleanTime(raw: string): string {
  // AlAdhan sometimes appends an offset like "04:40 (+03)".
  return raw.split(' ')[0];
}

interface AlAdhanDay {
  timings: Record<string, string>;
  meta: { timezone: string; method: { name: string } };
  date: { hijri: { day: string; month: { ar: string }; year: string } };
}

async function fetchDayFromApi(location: AdhanLocation, dateKey: string): Promise<AdhanDay> {
  let url: string;
  if (location.kind === 'gps') {
    url = `https://api.aladhan.com/v1/timings/${toApiDate(dateKey)}?latitude=${location.lat}&longitude=${location.lng}`;
  } else {
    const country = ADHAN_COUNTRIES.find((c) => c.code === location.country);
    const method = country?.method ? `&method=${country.method}` : '';
    url = `https://api.aladhan.com/v1/timingsByCity/${toApiDate(dateKey)}?city=${encodeURIComponent(location.city)}&country=${encodeURIComponent(country?.api ?? location.countryName)}${method}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`AlAdhan ${res.status}`);
  const json = (await res.json()) as { code: number; data: AlAdhanDay };
  if (json.code !== 200 || !json.data) throw new Error('AlAdhan bad response');
  const d = json.data;
  const timings: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.timings)) timings[k] = cleanTime(v);
  const hijri = d.date?.hijri ? `${d.date.hijri.day} ${d.date.hijri.month.ar} ${d.date.hijri.year}هـ` : '';
  return {
    timings,
    timezone: d.meta.timezone,
    methodName: d.meta.method?.name ?? '',
    hijri,
    dateKey,
  };
}

export async function ensureAdhanDay(location: AdhanLocation): Promise<AdhanDay> {
  const key = adhanLocationKey(location);
  try {
    const cached = localStorage.getItem(ADHAN_DAY_KEY);
    if (cached) {
      const p = JSON.parse(cached) as { locKey: string; day: AdhanDay };
      if (p.locKey === key && p.day && dateInTimezone(p.day.timezone) === p.day.dateKey) {
        return p.day;
      }
    }
  } catch {
    // Fall through to fetch.
  }
  // First fetch with the device date to learn the location timezone,
  // then refetch with the location-timezone date if it differs
  // (only matters near midnight across timezones).
  const first = await fetchDayFromApi(location, deviceDateKey());
  const tzDate = dateInTimezone(first.timezone);
  const day = tzDate === first.dateKey ? first : await fetchDayFromApi(location, tzDate);
  try {
    localStorage.setItem(ADHAN_DAY_KEY, JSON.stringify({ locKey: key, day }));
  } catch {
    // Cache is a convenience, not a requirement.
  }
  return day;
}

function loadFired(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(ADHAN_FIRED_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, string[]>;
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

export function adhanAlreadyFired(dateKey: string, prayer: string): boolean {
  return (loadFired()[dateKey] ?? []).includes(prayer);
}

export function markAdhanFired(dateKey: string, prayer: string): void {
  try {
    const all = loadFired();
    const list = all[dateKey] ?? [];
    if (!list.includes(prayer)) list.push(prayer);
    all[dateKey] = list;
    localStorage.setItem(ADHAN_FIRED_KEY, JSON.stringify(all));
  } catch {
    // Fired-marking is best-effort; the minute match still guards repeats.
  }
}

// Play the chosen alert sound. Returns the audio element for the
// full adhan (so the banner can stop it), null for the beep.
export function playAdhanSound(sound: AdhanSound): HTMLAudioElement | null {
  if (sound === 'beep') {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      [0, 0.6, 1.2].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.45);
      });
    } catch {
      // Beep is best-effort.
    }
    return null;
  }
  try {
    const audio = new Audio(ADHAN_AUDIO_URL);
    void audio.play().catch(() => {
      // iOS blocks playback without a prior user gesture in this
      // session — the banner still shows, and the next alert after
      // any tap will sound.
    });
    return audio;
  } catch {
    return null;
  }
}
