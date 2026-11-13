// Qibla direction (2026-11-13): great-circle bearing from the user to the
// Kaaba. Pure maths, nothing is sent anywhere.
const KAABA = { lat: 21.422487, lng: 39.826206 };
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Bearing in degrees clockwise from true north (0–360). */
export function qiblaBearing(lat: number, lng: number): number {
  const p1 = rad(lat), p2 = rad(KAABA.lat), dl = rad(KAABA.lng - lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Distance to the Kaaba in km. */
export function kaabaDistanceKm(lat: number, lng: number): number {
  const R = 6371, dp = rad(KAABA.lat - lat), dl = rad(KAABA.lng - lng);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(KAABA.lat)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Google Maps search for the nearest mosques. With coordinates the map is
 *  centred on the device; without them Maps uses its own location. */
export function nearestMosqueUrl(pos?: { lat: number; lng: number } | null): string {
  return pos
    ? `https://www.google.com/maps/search/mosque/@${pos.lat.toFixed(5)},${pos.lng.toFixed(5)},15z`
    : 'https://www.google.com/maps/search/?api=1&query=mosque';
}

export function getPosition(timeoutMs = 10000): Promise<{ lat: number; lng: number }> {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) { rej(new Error('nogeo')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => rej(e),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 },
    );
  });
}
