// Is this device on mobile data, as far as the browser says? (2026-11-26,
// shared by the device-ear download rule and 9.8.) Cellular, saveData or an
// unknown connection (no navigator.connection, e.g. Safari; or no `type`)
// count as mobile data.
export function onMobileData(): boolean {
  const c = (typeof navigator === 'undefined' ? undefined : (navigator as unknown as { connection?: { type?: string; saveData?: boolean } }).connection);
  if (!c) return true;
  if (c.saveData === true || c.type === 'cellular') return true;
  return !(c.type === 'wifi' || c.type === 'ethernet');
}
