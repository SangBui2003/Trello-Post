const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT,
  cookie_string TEXT,
  pages TEXT DEFAULT '[]',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT,
  url TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS packs (
  id TEXT PRIMARY KEY,
  name TEXT,
  posts TEXT DEFAULT '[]',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS queues (
  id TEXT PRIMARY KEY,
  name TEXT,
  profile_id TEXT,
  page_identity TEXT DEFAULT 'personal',
  group_ids TEXT DEFAULT '[]',
  posts TEXT DEFAULT '[]',
  delay_minutes INTEGER DEFAULT 5,
  approval_mode INTEGER DEFAULT 0,
  enable_timer INTEGER DEFAULT 1,
  state TEXT DEFAULT '{}',
  logs TEXT DEFAULT '[]',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sync_queues (
  id TEXT PRIMARY KEY,
  name TEXT,
  profile_id TEXT,
  page_identity TEXT DEFAULT 'personal',
  group_ids TEXT DEFAULT '[]',
  delay_minutes INTEGER DEFAULT 1,
  state TEXT DEFAULT '{}',
  logs TEXT DEFAULT '[]',
  created_at TEXT,
  updated_at TEXT
);
`;

module.exports = { SCHEMA_SQL };
