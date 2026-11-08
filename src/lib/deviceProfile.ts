// Per-device settings for the signed-in account (2026-11-08).
// The device kind is chosen once per browser (kept in localStorage) and the
// settings are stored in Supabase table user_device_settings (see
// supabase/device_settings.sql), keyed by (user_id, device_kind).
import { supabase } from './supabase';

export type DeviceKind = 'phone' | 'ipad' | 'tv' | 'desktop';

export const DEVICE_KIND_KEY = 'quran-device-kind-v1';
export const DEVICE_KINDS: DeviceKind[] = ['phone', 'ipad', 'tv', 'desktop'];

export function getLocalDeviceKind(): DeviceKind | null {
  try {
    const v = localStorage.getItem(DEVICE_KIND_KEY);
    return DEVICE_KINDS.includes(v as DeviceKind) ? (v as DeviceKind) : null;
  } catch {
    return null;
  }
}

export function setLocalDeviceKind(kind: DeviceKind): void {
  try {
    localStorage.setItem(DEVICE_KIND_KEY, kind);
  } catch {
    // storage blocked: the choice just won't persist
  }
}

export async function loadDeviceSettings(
  userId: string,
  kind: DeviceKind,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from('user_device_settings')
    .select('settings')
    .eq('user_id', userId)
    .eq('device_kind', kind)
    .maybeSingle();
  if (error || !data) return {};
  return (data.settings as Record<string, unknown>) ?? {};
}

export async function saveDeviceSettings(
  userId: string,
  kind: DeviceKind,
  settings: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await supabase
    .from('user_device_settings')
    .upsert(
      { user_id: userId, device_kind: kind, settings, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,device_kind' },
    );
  return !error;
}
