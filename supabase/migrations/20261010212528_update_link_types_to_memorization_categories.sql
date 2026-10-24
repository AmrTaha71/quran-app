/*
# Update link_types CHECK constraint to memorization-focused categories

1. Changes
- Drop old CHECK constraint on ayah_links.link_types that allowed: hifz, tafsir, audio, video, dhini, lafdhi, adadi, mantiqi, mutashabihat
- Add new CHECK constraint allowing: wajih, sifa, mutashabihat, sabab_nuzul, fawaaid, lafdhi, adadi, maqam, takrir
- These are well-known categories that help with Quran memorization (hifz)

2. Notes
- link_types is a text[] column (array), so the constraint uses the array element check
- Existing data with old type values will be migrated to the closest new category
*/

-- First, migrate existing data to new categories
UPDATE ayah_links SET link_types = ARRAY(
  SELECT CASE t
    WHEN 'hifz' THEN 'wajih'
    WHEN 'tafsir' THEN 'fawaaid'
    WHEN 'audio' THEN 'maqam'
    WHEN 'video' THEN 'wajih'
    WHEN 'dhini' THEN 'fawaaid'
    WHEN 'mantiqi' THEN 'sabab_nuzul'
    ELSE t
  END
  FROM unnest(link_types) AS t
)
WHERE link_types && ARRAY['hifz', 'tafsir', 'audio', 'video', 'dhini', 'mantiqi'];

-- Drop old constraint and add new one
ALTER TABLE ayah_links DROP CONSTRAINT IF EXISTS ayah_links_link_types_check;
ALTER TABLE ayah_links DROP CONSTRAINT IF EXISTS link_types_check;

ALTER TABLE ayah_links ADD CONSTRAINT ayah_links_link_types_check
  CHECK (link_types IS NULL OR link_types = '{}' OR array_to_string(link_types, ',') ~ '^(wajih|sifa|mutashabihat|sabab_nuzul|fawaaid|lafdhi|adadi|maqam|takrir)(,(wajih|sifa|mutashabihat|sabab_nuzul|fawaaid|lafdhi|adadi|maqam|takrir))*$');
