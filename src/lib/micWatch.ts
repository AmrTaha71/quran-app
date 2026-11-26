// 3.14 (2026-11-26): the dead-mic check both ears share (was Lab-only).
// The mic light can be on while no sound arrives (iOS audio-session glitch,
// ~half of the starts; also right after a spoken correction). At 0.7 s: no
// audio callbacks at all, or a dead track -> rebuild at once. At 1.8 s:
// still pure digital silence or a muted track -> rebuild. Up to 2 rebuilds,
// then the caller reports 'audio-capture'.
export type MicWatchTarget = {
  stopped: () => boolean;
  frames: () => number;
  maxRms: () => number;
  track: () => MediaStreamTrack | undefined;
  retries: () => number;
  /** diag label, e.g. 'dead-early-noframes' */
  mark?: (label: string) => void;
  rebuild: () => void;
  giveUp: () => void;
};

export const MIC_WATCH_EARLY_MS = 700;
export const MIC_WATCH_LATE_MS = 1800;
export const MIC_WATCH_MAX_REBUILDS = 2;

export function watchMic(t: MicWatchTarget): void {
  const check = (final: boolean) => {
    if (t.stopped()) return;
    const track = t.track();
    const noFrames = t.frames() === 0;
    const trackDead = !track || track.readyState !== 'live';
    const dead = noFrames || trackDead || (final && (t.maxRms() < 1e-6 || !!track?.muted));
    if (!dead) { if (!final) setTimeout(() => check(true), MIC_WATCH_LATE_MS - MIC_WATCH_EARLY_MS); return; }
    t.mark?.(`dead-${final ? 'late' : 'early'}${noFrames ? '-noframes' : trackDead ? '-track' : '-silent'}`);
    if (t.retries() >= MIC_WATCH_MAX_REBUILDS) { t.giveUp(); return; }
    t.rebuild();
  };
  setTimeout(() => check(false), MIC_WATCH_EARLY_MS);
}
