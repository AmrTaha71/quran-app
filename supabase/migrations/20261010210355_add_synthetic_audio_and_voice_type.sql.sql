/*
# Add synthetic audio + voice type to ayah_links

- synthetic_audio_url: URL of the AI-generated voice clip (male/female)
- voice_type: which voice was used (male / female)
- allows users to hear a polished synthetic voice, while Rana's original
  audio is preserved separately in audio_url
*/

ALTER TABLE ayah_links ADD COLUMN IF NOT EXISTS synthetic_audio_url text;
ALTER TABLE ayah_links ADD COLUMN IF NOT EXISTS voice_type text
  CHECK (voice_type IN ('male', 'female') OR voice_type IS NULL);
