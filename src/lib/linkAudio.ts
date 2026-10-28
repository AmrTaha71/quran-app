// Voice policy for ayah links (2026-10-28, user's words):
//   - Female user → Rana's original recording if it exists, else the
//     generated female voice. Rana chooses per link by recording her
//     voice or generating a female voice instead (when both exist,
//     her original wins — it is the primary voice).
//   - Male user → ALWAYS the generated male voice. He never hears
//     Rana's voice or the female voice.
//   - Fallbacks exist only so a link never plays silence: a male
//     user falls back to the original, then the female voice, until
//     a male voice is generated for that link; a female user falls
//     back to the male voice only if nothing else exists.
// Gender comes from user_profiles.gender; the Settings page mirrors
// it into localStorage ('quran-user-gender') so pages can resolve
// before the profile loads. Unknown gender → female side (the
// historical default). No user-facing surface names any person:
// labels are only 'صوت نسائي' / 'صوت رجالي', by what actually plays.
export type LinkGender = 'male' | 'female';

export function getStoredLinkGender(profileGender: 'male' | 'female' | null): LinkGender {
  if (profileGender === 'male' || profileGender === 'female') return profileGender;
  try {
    const s = localStorage.getItem('quran-user-gender');
    if (s === 'male' || s === 'female') return s;
  } catch {}
  return 'female';
}

export interface LinkAudioTrack {
  audio_url: string | null;
  synthetic_audio_url: string | null;
  voice_type: 'male' | 'female' | null;
  synthetic_audio_url_female: string | null;
  synthetic_audio_url_male: string | null;
}

export interface ResolvedLinkAudio {
  url: string;
  label: string;
  kind: 'original' | 'female-synth' | 'male-synth';
}

export function resolveLinkAudio(link: LinkAudioTrack, gender: LinkGender): ResolvedLinkAudio | null {
  // Legacy rows (written before the gendered columns existed) carry
  // their one synthetic in synthetic_audio_url + voice_type.
  const femaleSynth = link.synthetic_audio_url_female
    ?? (link.voice_type === 'female' ? link.synthetic_audio_url : null);
  const maleSynth = link.synthetic_audio_url_male
    ?? (link.voice_type === 'male' ? link.synthetic_audio_url : null);
  if (gender === 'male') {
    if (maleSynth) return { url: maleSynth, label: 'صوت رجالي', kind: 'male-synth' };
    if (link.audio_url) return { url: link.audio_url, label: 'صوت نسائي', kind: 'original' };
    if (femaleSynth) return { url: femaleSynth, label: 'صوت نسائي', kind: 'female-synth' };
    return null;
  }
  if (link.audio_url) return { url: link.audio_url, label: 'صوت نسائي', kind: 'original' };
  if (femaleSynth) return { url: femaleSynth, label: 'صوت نسائي', kind: 'female-synth' };
  if (maleSynth) return { url: maleSynth, label: 'صوت رجالي', kind: 'male-synth' };
  return null;
}
