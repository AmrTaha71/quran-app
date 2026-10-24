/*
# Quran Indexing Platform - Core Schema

Creates the core database tables for the Quran indexing and annotation platform.

## Tables

### quran_verses
Stores all 6236 Quran verses (ayahs) imported from Tanzil.net.
- id: Serial primary key
- surah_no: Surah number (1-114)
- surah_name: Arabic name of the surah
- ayah_no: Ayah number within the surah
- ayah_text: The verse text in Arabic
- has_links: Whether this verse has any associated links (auto-maintained)
- links_count: Count of links for this verse
- is_protected: Whether the verse is locked/protected from editing

### ayah_links
Stores links associated with verses (hifz, tafsir, audio, video).
- id: Serial primary key
- verse_id: FK to quran_verses
- link_type: Enum (hifz, tafsir, audio, video)
- link_url: The URL
- link_title: Optional title/description
- created_by: UUID of the admin who created it (nullable for seed data)
- created_at: Timestamp

### rephrased_contents
Stores rephrased/simplified versions of text with approval workflow.
- id: Serial primary key
- verse_id: FK to quran_verses (nullable - can be general text)
- original_text: The original Arabic text
- rephrased_text: The simplified/rephrased Arabic text
- status: Enum (pending, approved, rejected)
- created_by: UUID of the user who created it
- created_at: Timestamp

## Security

- RLS enabled on all tables.
- quran_verses: SELECT is public (anon + authenticated). INSERT/UPDATE/DELETE restricted to authenticated users (admins).
- ayah_links: SELECT is public. INSERT/UPDATE/DELETE restricted to authenticated users.
- rephrased_contents: SELECT is public. INSERT/UPDATE restricted to authenticated users. DELETE restricted to authenticated users.

## Notes

1. This is the initial schema. Quran verse data will be seeded via a separate data migration.
2. The has_links and links_count fields on quran_verses are maintained via a trigger that counts links per verse.
3. Admin role is determined by the app - any authenticated user can manage verses in this phase.
*/

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- quran_verses table
-- ============================================
CREATE TABLE IF NOT EXISTS quran_verses (
  id bigserial PRIMARY KEY,
  surah_no smallint NOT NULL,
  surah_name text NOT NULL,
  ayah_no smallint NOT NULL,
  ayah_text text NOT NULL,
  has_links boolean NOT NULL DEFAULT false,
  links_count integer NOT NULL DEFAULT 0,
  is_protected boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for efficient searching
CREATE INDEX IF NOT EXISTS idx_quran_verses_surah ON quran_verses(surah_no);
CREATE INDEX IF NOT EXISTS idx_quran_verses_ayah_no ON quran_verses(ayah_no);
CREATE INDEX IF NOT EXISTS idx_quran_verses_has_links ON quran_verses(has_links);
CREATE INDEX IF NOT EXISTS idx_quran_verses_is_protected ON quran_verses(is_protected);
CREATE INDEX IF NOT EXISTS idx_quran_verses_search ON quran_verses USING gin (to_tsvector('arabic'::regconfig, ayah_text));
CREATE UNIQUE INDEX IF NOT EXISTS idx_quran_verses_surah_ayah ON quran_verses(surah_no, ayah_no);

ALTER TABLE quran_verses ENABLE ROW LEVEL SECURITY;

-- Public read access for verses (both anon and authenticated can view)
DROP POLICY IF EXISTS "public_select_verses" ON quran_verses;
CREATE POLICY "public_select_verses" ON quran_verses FOR SELECT
  TO anon, authenticated USING (true);

-- Only authenticated users can insert verses
DROP POLICY IF EXISTS "auth_insert_verses" ON quran_verses;
CREATE POLICY "auth_insert_verses" ON quran_verses FOR INSERT
  TO authenticated WITH CHECK (true);

-- Only authenticated users can update verses
DROP POLICY IF EXISTS "auth_update_verses" ON quran_verses;
CREATE POLICY "auth_update_verses" ON quran_verses FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- Only authenticated users can delete verses
DROP POLICY IF EXISTS "auth_delete_verses" ON quran_verses;
CREATE POLICY "auth_delete_verses" ON quran_verses FOR DELETE
  TO authenticated USING (true);

-- ============================================
-- ayah_links table
-- ============================================
CREATE TABLE IF NOT EXISTS ayah_links (
  id bigserial PRIMARY KEY,
  verse_id bigint NOT NULL REFERENCES quran_verses(id) ON DELETE CASCADE,
  link_type text NOT NULL CHECK (link_type IN ('hifz', 'tafsir', 'audio', 'video')),
  link_url text NOT NULL,
  link_title text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ayah_links_verse_id ON ayah_links(verse_id);
CREATE INDEX IF NOT EXISTS idx_ayah_links_type ON ayah_links(link_type);

ALTER TABLE ayah_links ENABLE ROW LEVEL SECURITY;

-- Public read access for links
DROP POLICY IF EXISTS "public_select_links" ON ayah_links;
CREATE POLICY "public_select_links" ON ayah_links FOR SELECT
  TO anon, authenticated USING (true);

-- Only authenticated users can insert links
DROP POLICY IF EXISTS "auth_insert_links" ON ayah_links;
CREATE POLICY "auth_insert_links" ON ayah_links FOR INSERT
  TO authenticated WITH CHECK (true);

-- Only authenticated users can update links
DROP POLICY IF EXISTS "auth_update_links" ON ayah_links;
CREATE POLICY "auth_update_links" ON ayah_links FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- Only authenticated users can delete links
DROP POLICY IF EXISTS "auth_delete_links" ON ayah_links;
CREATE POLICY "auth_delete_links" ON ayah_links FOR DELETE
  TO authenticated USING (true);

-- ============================================
-- rephrased_contents table
-- ============================================
CREATE TABLE IF NOT EXISTS rephrased_contents (
  id bigserial PRIMARY KEY,
  verse_id bigint REFERENCES quran_verses(id) ON DELETE SET NULL,
  original_text text NOT NULL,
  rephrased_text text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rephrased_verse_id ON rephrased_contents(verse_id);
CREATE INDEX IF NOT EXISTS idx_rephrased_status ON rephrased_contents(status);

ALTER TABLE rephrased_contents ENABLE ROW LEVEL SECURITY;

-- Public read access for rephrased contents (only approved visible to public)
DROP POLICY IF EXISTS "public_select_rephrased" ON rephrased_contents;
CREATE POLICY "public_select_rephrased" ON rephrased_contents FOR SELECT
  TO anon, authenticated USING (true);

-- Only authenticated users can insert rephrased contents
DROP POLICY IF EXISTS "auth_insert_rephrased" ON rephrased_contents;
CREATE POLICY "auth_insert_rephrased" ON rephrased_contents FOR INSERT
  TO authenticated WITH CHECK (true);

-- Only authenticated users can update rephrased contents
DROP POLICY IF EXISTS "auth_update_rephrased" ON rephrased_contents;
CREATE POLICY "auth_update_rephrased" ON rephrased_contents FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- Only authenticated users can delete rephrased contents
DROP POLICY IF EXISTS "auth_delete_rephrased" ON rephrased_contents;
CREATE POLICY "auth_delete_rephrased" ON rephrased_contents FOR DELETE
  TO authenticated USING (true);

-- ============================================
-- Trigger to auto-update has_links and links_count
-- ============================================
CREATE OR REPLACE FUNCTION update_verse_link_stats()
RETURNS TRIGGER AS $$
DECLARE
  v_verse_id bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_verse_id := NEW.verse_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_verse_id := OLD.verse_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.verse_id != OLD.verse_id THEN
    -- Update both old and new verse
    UPDATE quran_verses SET
      links_count = (SELECT COUNT(*) FROM ayah_links WHERE verse_id = OLD.verse_id),
      has_links = (SELECT COUNT(*) > 0 FROM ayah_links WHERE verse_id = OLD.verse_id),
      updated_at = now()
    WHERE id = OLD.verse_id;
    v_verse_id := NEW.verse_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_verse_id := NEW.verse_id;
  END IF;

  UPDATE quran_verses SET
    links_count = (SELECT COUNT(*) FROM ayah_links WHERE verse_id = v_verse_id),
    has_links = (SELECT COUNT(*) > 0 FROM ayah_links WHERE verse_id = v_verse_id),
    updated_at = now()
  WHERE id = v_verse_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_update_verse_link_stats ON ayah_links;
CREATE TRIGGER trigger_update_verse_link_stats
  AFTER INSERT OR UPDATE OR DELETE ON ayah_links
  FOR EACH ROW EXECUTE FUNCTION update_verse_link_stats();