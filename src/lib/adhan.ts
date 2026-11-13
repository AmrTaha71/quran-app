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
export type AdhanSound = 'full' | 'beep' | 'takbir';

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
      sound: p.sound === 'beep' ? 'beep' : p.sound === 'takbir' ? 'takbir' : 'full',
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

export async function fetchDayFromApi(location: AdhanLocation, dateKey: string): Promise<AdhanDay> {
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
// Muezzin choices (2026-11-09). Files live in the public `adhan` bucket;
// a voice whose file is not uploaded yet is hidden by the settings UI.
const COMMONS = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
const ADHAN_BUCKET = 'https://xfhjlukkvjzlmrggvowm.supabase.co/storage/v1/object/public/adhan/';
export const ADHAN_VOICES: { id: string; name: string; url: string; credit: string }[] = [
  { id: 'makkah', name: 'المسجد الحرام', url: ADHAN_AUDIO_URL, credit: ADHAN_AUDIO_CREDIT },
  // Wikimedia Commons free-licence files, played straight from Commons.
  { id: 'c-madinah', name: 'المسجد النبوي', url: COMMONS + '33937_ejaz215_call-to-prayer-from-the-prophet-s-mo.ogg', credit: 'ejaz215 (Freesound) — Wikimedia Commons, CC BY' },
  { id: 'c-beautiful', name: 'أذان هادئ', url: COMMONS + 'Beautiful_adhan.ogg', credit: 'Adam-synagda — Wikimedia Commons, ملكية عامة' },
  { id: 'c-azan', name: 'أذان طويل', url: COMMONS + 'Azan.ogg', credit: 'Andrewler — Wikimedia Commons, CC BY-SA 4.0' },
  { id: 'c-aaqib', name: 'أذان عاقب عزيز (قصير ١:٢٧)', url: COMMONS + 'The_Adhan_-_Muslim_Call_to_Prayer_-_Aaqib_Azeez.mp3', credit: 'Atcovi — Wikimedia Commons (own work)' },
  { id: 'cairo-hamed', name: 'الشيخ حامد — مسجد المحمودية، القاهرة', url: ADHAN_BUCKET + 'cairo-hamed-mahmoudeya.mp3', credit: 'Anna Kipervaser / On Look Films — World Oral Literature Project, Cambridge (CC BY-NC-ND 3.0)' },
  { id: 'cairo-ahmed', name: 'الشيخ أحمد — مسجد عمر مكرم، القاهرة', url: ADHAN_BUCKET + 'cairo-ahmed-omarmakram.mp3', credit: 'Anna Kipervaser / On Look Films — World Oral Literature Project, Cambridge (CC BY-NC-ND 3.0)' },
  { id: 'cairo-mohamed', name: 'الشيخ محمد — مسجد الشيخ عبد الله، الجمالية', url: ADHAN_BUCKET + 'cairo-mohamed-gamaliya.mp3', credit: 'Anna Kipervaser / On Look Films — World Oral Literature Project, Cambridge (CC BY-NC-ND 3.0)' },
];
export const ADHAN_VOICE_KEY = 'quran-adhan-voice';
export function getAdhanVoice() {
  let id = 'makkah';
  try { id = localStorage.getItem(ADHAN_VOICE_KEY) || 'makkah'; } catch { /* ignore */ }
  return ADHAN_VOICES.find((v) => v.id === id) ?? ADHAN_VOICES[0];
}
export function setAdhanVoice(id: string): void {
  try { localStorage.setItem(ADHAN_VOICE_KEY, id); } catch { /* ignore */ }
}
/** Offline download of one adhan voice (served cache-first by the SW). */
export const ADHAN_CACHE = 'quran-adhan';
export async function isAdhanVoiceDownloaded(id: string): Promise<boolean> {
  const v = ADHAN_VOICES.find((x) => x.id === id);
  if (!v || !('caches' in window)) return false;
  try { return !!(await (await caches.open(ADHAN_CACHE)).match(v.url)); } catch { return false; }
}
export async function downloadAdhanVoice(id: string): Promise<boolean> {
  const v = ADHAN_VOICES.find((x) => x.id === id);
  if (!v || !('caches' in window)) return false;
  try {
    const c = await caches.open(ADHAN_CACHE);
    let r: Response;
    try { r = await fetch(v.url, { mode: 'cors' }); if (!r.ok) throw new Error(String(r.status)); }
    catch { r = await fetch(v.url, { mode: 'no-cors' }); }
    await c.put(v.url, r);
    return true;
  } catch { return false; }
}

/** Which voices are actually uploaded (HEAD check). */
export async function availableAdhanVoices(): Promise<string[]> {
  const ok = await Promise.all(ADHAN_VOICES.map((v) => (!v.url.startsWith(ADHAN_BUCKET) || v.id === 'makkah' ? Promise.resolve(true)
    : fetch(v.url, { method: 'HEAD' }).then((r) => r.ok).catch(() => false))));
  return ADHAN_VOICES.filter((_, i) => ok[i]).map((v) => v.id);
}

// Playback windows (seconds) — the files themselves are NOT cut (some are
// CC BY-ND); we only seek and stop. Measured by the owner by ear.
// takbir: «الله أكبر الله أكبر» only. fullStart: skip silent intros.
export const TAKBIR_RANGE: Record<string, [number, number]> = {
  makkah: [7, 31],
  'c-madinah': [3, 35],
  'c-beautiful': [0, 18],
  'c-azan': [0, 18],
  'c-aaqib': [2, 13],
};
export const TAKBIR_DEFAULT: [number, number] = [0, 9];
export const FULL_START: Record<string, number> = { makkah: 6 };

function applyWindow(audio: HTMLAudioElement, start: number, end: number | null): void {
  let seeked = start <= 0;
  const seek = () => {
    if (seeked) return;
    try { audio.currentTime = start; seeked = true; } catch { /* retry on next event */ }
  };
  audio.addEventListener('loadedmetadata', seek);
  audio.addEventListener('canplay', seek);
  audio.addEventListener('playing', seek);
  if (end == null) return;
  let fading = false;
  audio.addEventListener('timeupdate', () => {
    if (fading || audio.currentTime < end) return;
    fading = true;
    const step = window.setInterval(() => {
      audio.volume = Math.max(0, audio.volume - 0.15);
      if (audio.volume <= 0.02) {
        window.clearInterval(step);
        audio.pause(); audio.volume = 1;
        audio.dispatchEvent(new Event('ended'));
      }
    }, 60);
  });
}

export function playAdhanSound(sound: AdhanSound, voiceId?: string): HTMLAudioElement | null {
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
    const v = voiceId ? (ADHAN_VOICES.find((x) => x.id === voiceId) ?? getAdhanVoice()) : getAdhanVoice();
    const audio = new Audio(v.url);
    audio.onerror = () => { if (v.id !== 'makkah') { audio.src = ADHAN_AUDIO_URL; void audio.play().catch(() => {}); } };
    if (sound === 'takbir') { const [st, en] = TAKBIR_RANGE[v.id] ?? TAKBIR_DEFAULT; applyWindow(audio, st, en); }
    else if (FULL_START[v.id]) applyWindow(audio, FULL_START[v.id], null);
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

// 2026-11-12 (review D1): grace window. The 30-second foreground pulse is
// throttled by iOS and can skip the exact minute, so a prayer counts as due
// for GRACE minutes after its time (not only in the exact minute).
export const ADHAN_GRACE_MINUTES = 5;

// Minutes from `prayer` (HH:MM) to `now` (HH:MM), wrapped to (-720, 720].
// Returns true when `now` is in [prayer, prayer + grace].
export function adhanDueNow(now: string, prayer: string, grace = ADHAN_GRACE_MINUTES): boolean {
  const toMin = (s: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };
  const n = toMin(now);
  const p = toMin(prayer);
  if (Number.isNaN(n) || Number.isNaN(p)) return false;
  let diff = n - p;
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff >= 0 && diff <= grace;
}
