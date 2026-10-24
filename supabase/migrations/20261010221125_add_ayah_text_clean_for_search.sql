-- Add a generated column that strips Arabic diacritics for search
-- This allows searching "الرحمن" to match "الرَّحۡمٰنِ" in the database
ALTER TABLE quran_verses ADD COLUMN IF NOT EXISTS ayah_text_clean text GENERATED ALWAYS AS (
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(ayah_text, '[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u08D3-\u08FF\u0640\u200C\u200D\u200E\u200F\u061C]', '', 'g'),
        'ـ', '', 'g'
      ),
      '‏', '', 'g'
    ),
    '‌', '', 'g'
  )
) STORED;

-- Add index for faster search
CREATE INDEX IF NOT EXISTS idx_quran_verses_text_clean ON quran_verses USING gin (to_tsvector('simple', ayah_text_clean));
CREATE INDEX IF NOT EXISTS idx_quran_verses_text_clean_ilike ON quran_verses (ayah_text_clean text_pattern_ops);

-- Verify it works
SELECT id, surah_no, ayah_no, left(ayah_text_clean, 50) as clean_text
FROM quran_verses
WHERE surah_no = 1
ORDER BY ayah_no
LIMIT 3;
