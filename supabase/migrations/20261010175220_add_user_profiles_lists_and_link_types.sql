/*
# User profiles, user lists, and expanded link types

## New Tables
### user_profiles
Stores extended user data for gender-aware language and country info.
- id, user_id, username, full_name, gender, birth_date, country_code, phone, preferred_language, created_at

### user_lists
Stores user bookmark collections (favorites, read_later, difficult).
- id, user_id, verse_id, list_type, link_id, created_at

## Modified Tables
### ayah_links
- Added new link_type values: dhini, lafdhi, adadi, mantiqi, mutashabihat

## Security
- user_profiles and user_lists: owner-scoped CRUD (authenticated only)
*/

CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE,
  full_name text,
  gender text CHECK (gender IN ('male', 'female')),
  birth_date date,
  country_code text DEFAULT '+20',
  phone text,
  preferred_language text DEFAULT 'ar',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON user_profiles;
CREATE POLICY "select_own_profile" ON user_profiles FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_profile" ON user_profiles;
CREATE POLICY "insert_own_profile" ON user_profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_profile" ON user_profiles;
CREATE POLICY "update_own_profile" ON user_profiles FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_profile" ON user_profiles;
CREATE POLICY "delete_own_profile" ON user_profiles FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS user_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  verse_id bigint NOT NULL REFERENCES quran_verses(id) ON DELETE CASCADE,
  list_type text NOT NULL CHECK (list_type IN ('favorites', 'read_later', 'difficult')),
  link_id bigint REFERENCES ayah_links(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, verse_id, list_type, link_id)
);

CREATE INDEX IF NOT EXISTS idx_user_lists_user ON user_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_user_lists_type ON user_lists(list_type);

ALTER TABLE user_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_lists" ON user_lists;
CREATE POLICY "select_own_lists" ON user_lists FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_lists" ON user_lists;
CREATE POLICY "insert_own_lists" ON user_lists FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_lists" ON user_lists;
CREATE POLICY "delete_own_lists" ON user_lists FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

ALTER TABLE ayah_links DROP CONSTRAINT IF EXISTS ayah_links_link_type_check;
ALTER TABLE ayah_links ADD CONSTRAINT ayah_links_link_type_check
  CHECK (link_type IN ('hifz', 'tafsir', 'audio', 'video', 'dhini', 'lafdhi', 'adadi', 'mantiqi', 'mutashabihat'));
