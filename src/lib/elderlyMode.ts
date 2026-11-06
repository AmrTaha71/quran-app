// Elderly mode (وضع كبار السن, approved 2026-11-06).
// Mirrors src/lib/mushafNight.ts exactly in structure: a localStorage
// key, an isX() reader, an applyX() that sets/deletes a
// document.documentElement.dataset attribute, and a setX() that writes
// storage + applies. The dataset attribute (data-elderly="1") is what
// src/elderly.css reads; the custom event lets React components
// (useElderlyMode) re-render when the mode flips from another tab or
// from Settings without a reload.
import { useState, useEffect } from 'react';

export const ELDERLY_MODE_KEY = 'quran-elderly-mode';

export function isElderlyMode(): boolean {
  try {
    return localStorage.getItem(ELDERLY_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function applyElderlyMode(on: boolean = isElderlyMode()): void {
  try {
    if (on) document.documentElement.dataset.elderly = '1';
    else delete document.documentElement.dataset.elderly;
  } catch {
    // decorative: never break the page
  }
}

export function setElderlyMode(on: boolean): void {
  try {
    localStorage.setItem(ELDERLY_MODE_KEY, on ? '1' : '0');
  } catch {
    // storage unavailable: the choice just won't persist
  }
  applyElderlyMode(on);
  try {
    window.dispatchEvent(new CustomEvent('quran-elderly-mode-changed'));
  } catch {
    // event dispatch is best-effort; the attribute above already applied
  }
}

export function useElderlyMode(): boolean {
  const [elderly, setElderly] = useState(isElderlyMode);
  useEffect(() => {
    const sync = () => setElderly(isElderlyMode());
    window.addEventListener('quran-elderly-mode-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('quran-elderly-mode-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return elderly;
}
