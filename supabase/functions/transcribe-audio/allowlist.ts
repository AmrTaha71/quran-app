// Audio hosts the app itself uses. Anything else is refused before fetch (SSRF guard).
// Hosts confirmed by owner 2026-11-28: project storage, cdn.islamic.network (riwayat/reciters/hadr),
// audio.qurancdn.com (word-by-word audio, lib/refWordUnits.ts).
export const EXTRA_AUDIO_HOSTS = ["cdn.islamic.network", "audio.qurancdn.com"] as const;

// Exact https hostnames only: no ports, no credentials, no redirects to other hosts.
export function isAllowedAudioUrl(raw: string, supabaseUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port !== "" || u.username !== "" || u.password !== "") return false;
  let projectHost: string;
  try {
    projectHost = new URL(supabaseUrl).hostname;
  } catch {
    return false; // malformed SUPABASE_URL: fail closed without throwing
  }
  return new Set<string>([projectHost, ...EXTRA_AUDIO_HOSTS]).has(u.hostname);
}
