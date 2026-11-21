/*
  Merged links and far links (2026-11-21, Dr. Amr). Additive only: two nullable columns + indexes.
  - group_verse_ids: ids of all ayat covered by ONE link (consecutive ayat of the same surah). verse_id stays the first one.
  - related_verse_id: a second ayah anywhere in the Mushaf that this link ties verse_id to.
  Already applied to the live project via the Supabase connector.
*/
ALTER TABLE ayah_links ADD COLUMN IF NOT EXISTS group_verse_ids bigint[];
ALTER TABLE ayah_links ADD COLUMN IF NOT EXISTS related_verse_id bigint;
CREATE INDEX IF NOT EXISTS idx_ayah_links_group_verse_ids ON ayah_links USING gin (group_verse_ids);
CREATE INDEX IF NOT EXISTS idx_ayah_links_related_verse_id ON ayah_links (related_verse_id);
