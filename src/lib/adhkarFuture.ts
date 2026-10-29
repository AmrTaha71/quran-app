// adhkarFuture.ts — REALIZED 2026-10-29, kept as a compatibility shim.
//
// The old premise of this file (no adhkar audio until a licensed human
// source is cleared; one audio file per wird + timing table) is
// SUPERSEDED: on 2026-10-29 Amr chose generated voice instead, and
// 46 per-dhikr clips (23 texts x male/female) were generated via the
// existing generate-voice function. The live shape is:
//   - one clip file per dhikr (not one file per wird),
//   - repetitions performed by the player (not baked into audio),
//   - male/female voice toggle, default male (Amr's pick),
//   - the voice is labelled "صوت مولّد" everywhere, never human.
// The real data + types live in adhkarClips.ts (generated from the
// manifest); the player is AdhkarPage.tsx (#/adhkar).

export type { AdhkarClip, AdhkarVoice, AdhkarWird } from './adhkarClips';
