-- 内容数仓：共享曲库 + 共享书库 + 章节正文
-- 在 WorkBuddy 云数据库执行（每条语句单独执行）；owner 由 auth.uid() 与 RLS 保证。
-- 已于 2026-11-25 在云端执行完毕，此文件为存档与重建依据。

-- ── 1. music_library 共享曲库 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS music_library (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '默认',
  cloud_path TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE music_library IS '共享曲库：管理后台上传的 MP3/音频元数据，文件在 runtime 桶 users/<uid>/life-music/';

ALTER TABLE music_library ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE music_library TO authenticated, anon;
-- 策略：登录/匿名可读，写入仅限所有者（管理后台登录者）
CREATE POLICY music_library_read_all ON music_library FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY music_library_insert_own ON music_library FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY music_library_update_own ON music_library FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY music_library_delete_own ON music_library FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_music_library_category ON music_library (category, created_at DESC);

-- ── 2. books 共享书库 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS books (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '未分类',
  cover_url TEXT NOT NULL DEFAULT '',
  isbn TEXT NOT NULL DEFAULT '',
  pages INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'text',      -- text: 章节存 book_chapters; external: 走 source_url
  source_url TEXT NOT NULL DEFAULT '',
  cloud_path TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE books IS '共享书库：管理后台导入的书籍元数据；format=text 章节存 book_chapters，external 走 source_url';

ALTER TABLE books ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE books TO authenticated, anon;
CREATE POLICY books_read_all ON books FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY books_insert_own ON books FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY books_update_own ON books FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY books_delete_own ON books FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_books_category ON books (category, sort_order);

-- ── 3. book_chapters 章节正文 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS book_chapters (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE book_chapters ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE book_chapters TO authenticated, anon;
CREATE POLICY book_chapters_read_all ON book_chapters FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY book_chapters_insert_own ON book_chapters FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY book_chapters_update_own ON book_chapters FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY book_chapters_delete_own ON book_chapters FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_book_chapters_book ON book_chapters (book_id, chapter_index);
