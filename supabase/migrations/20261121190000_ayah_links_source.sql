-- Where a link came from: NULL = normal (admin/user/AI draft); 'books' = taken from athar/tafsir books.
ALTER TABLE ayah_links ADD COLUMN IF NOT EXISTS source text;
CREATE INDEX IF NOT EXISTS idx_ayah_links_source ON ayah_links(source) WHERE source IS NOT NULL;
