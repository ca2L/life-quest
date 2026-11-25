-- 角色卡表：开放世界同行角色 + 亲密度成长
-- 在 WorkBuddy 云数据库控制台执行；owner 归属由 auth.uid() 与 RLS 保证，前端不传 owner_id。

CREATE TABLE IF NOT EXISTS characters (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  name TEXT NOT NULL,
  avatar TEXT DEFAULT '🧍',
  relation TEXT DEFAULT '朋友',
  color TEXT DEFAULT '#6f5ce8',
  met_date TEXT DEFAULT '',
  story TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  intimacy INTEGER DEFAULT 0,
  meet_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE characters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "characters_owner_select" ON characters;
CREATE POLICY "characters_owner_select" ON characters
  FOR SELECT USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "characters_owner_insert" ON characters;
CREATE POLICY "characters_owner_insert" ON characters
  FOR INSERT WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "characters_owner_update" ON characters;
CREATE POLICY "characters_owner_update" ON characters
  FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "characters_owner_delete" ON characters;
CREATE POLICY "characters_owner_delete" ON characters
  FOR DELETE USING (owner_id = auth.uid());

-- 说明：建表成功后，角色卡会同时写本地 storage 与云端；
-- 未建表时功能自动降级为本地存储，预览环境依然可用，不会报错。
