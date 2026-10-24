/*
# Multi-type links, audio input, and admin review workflow

## Changes to ayah_links
1. link_type → link_types[] (text array — a link can have multiple tags)
2. Add audio_url (Supabase Storage path for Rana's audio clip)
3. Add status (pending → approved → rejected) for admin review
4. Add rephrased_content (AI-generated text from audio)
5. Add original_transcript (raw speech-to-text before rephrase)

## New storage bucket
- rana-audio: for uploaded/recorded audio clips
*/

-- Add new columns to ayah_links
ALTER TABLE ayah_links ADD COLUMN IF NOT EXISTS link_types text[] NOT NULL DEFAULT '{}';
ALTER TABLE ayah_links ADD COLUMN IF NOT EXISTS audio_url text;
ALTER TABLE ayah_links ADD COLUMN IF NOT EXISTS original_transcript text;
ALTER TABLE ayah_links ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved'
  CHECK (status IN ('pending', 'approved', 'rejected'));
ALTER TABLE ayah_links ADD COLUMN IF NOT EXISTS rephrase_command text;

-- Migrate existing data: copy single link_type into link_types array
UPDATE ayah_links SET link_types = ARRAY[link_type] WHERE link_types = '{}' AND link_type IS NOT NULL;

-- Drop old single link_type column (data preserved in link_types)
ALTER TABLE ayah_links DROP COLUMN IF EXISTS link_type;

-- Index for status-based queries (admin dashboard)
CREATE INDEX IF NOT EXISTS idx_ayah_links_status ON ayah_links(status);

-- Storage bucket for audio clips
INSERT INTO storage.buckets (id, name, public)
VALUES ('rana-audio', 'rana-audio', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload audio
DROP POLICY IF EXISTS "auth_upload_rana_audio" ON storage.objects;
CREATE POLICY "auth_upload_rana_audio" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rana-audio');

-- Public read for audio clips
DROP POLICY IF EXISTS "public_read_rana_audio" ON storage.objects;
CREATE POLICY "public_read_rana_audio" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'rana-audio');

-- Allow authenticated users to delete audio
DROP POLICY IF EXISTS "auth_delete_rana_audio" ON storage.objects;
CREATE POLICY "auth_delete_rana_audio" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'rana-audio');
