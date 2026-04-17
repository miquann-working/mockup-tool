const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "../../mockup.db");
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Schema ──────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS prompt_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER REFERENCES prompt_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gemini_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    email TEXT NOT NULL,
    cookie_dir TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'free' CHECK(status IN ('free','busy','cooldown','disabled')),
    last_used_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    prompt_id INTEGER NOT NULL REFERENCES prompts(id),
    account_id INTEGER REFERENCES gemini_accounts(id),
    original_image TEXT NOT NULL,
    mockup_image TEXT,
    line_image TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','mockup_done','done','error')),
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── Migration: add batch_id to existing tables ─────────────
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN batch_id TEXT`);
} catch (e) {
  // column already exists – ignore
}

// ── Migration: add group_id to prompts ─────────────
try {
  db.exec(`ALTER TABLE prompts ADD COLUMN group_id INTEGER REFERENCES prompt_groups(id) ON DELETE CASCADE`);
} catch (e) {
  // column already exists – ignore
}
// ── Migration: add user_id to gemini_accounts ─────
try {
  db.exec(`ALTER TABLE gemini_accounts ADD COLUMN user_id INTEGER REFERENCES users(id)`);
} catch (e) {
  // column already exists – ignore
}
// ── Migration: add image_style to prompt_groups ─────
try {
  db.exec(`ALTER TABLE prompt_groups ADD COLUMN image_style TEXT DEFAULT 'Chân dung dịu nhẹ'`);
} catch (e) {
  // column already exists – ignore
}
// ── Migration: add mode to prompts ('mockup' or 'line_drawing') ─────
try {
  db.exec(`ALTER TABLE prompts ADD COLUMN mode TEXT NOT NULL DEFAULT 'mockup'`);
} catch (e) {
  // column already exists – ignore
}
// ── Migration: add retry_count to jobs ─────
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`);
} catch (e) {
  // column already exists – ignore
}
// ── Migration: add rate_limited_until to gemini_accounts ─────
try {
  db.exec(`ALTER TABLE gemini_accounts ADD COLUMN rate_limited_until TEXT`);
} catch (e) {
  // column already exists – ignore
}
// ── Migration: add user_id to prompt_groups ─────
try {
  db.exec(`ALTER TABLE prompt_groups ADD COLUMN user_id INTEGER REFERENCES users(id)`);
} catch (e) {
  // column already exists – ignore
}
// ── Migration: add role to prompt_groups ('mockup' or 'trade') ─────
try {
  db.exec(`ALTER TABLE prompt_groups ADD COLUMN role TEXT NOT NULL DEFAULT 'mockup'`);
} catch (e) {
  // column already exists – ignore
}
// ── Migration: add vps_nodes table ─────
db.exec(`
  CREATE TABLE IF NOT EXISTS vps_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 5001,
    secret_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('online','offline','error')),
    max_concurrent INTEGER NOT NULL DEFAULT 3,
    last_heartbeat TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
// ── Migration: add vps_id to gemini_accounts ─────
try {
  db.exec(`ALTER TABLE gemini_accounts ADD COLUMN vps_id INTEGER REFERENCES vps_nodes(id)`);
} catch (e) {
  // column already exists – ignore
}
// ── Migration: add vps_id to users ─────
try {
  db.exec(`ALTER TABLE users ADD COLUMN vps_id INTEGER REFERENCES vps_nodes(id)`);
} catch (e) {
  // column already exists – ignore
}

// ── Migration: recreate users table to update CHECK constraint & rename roles ─────
try {
  const hasOldCheck = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`
  ).get();
  if (hasOldCheck && hasOldCheck.sql && hasOldCheck.sql.includes("('admin','user')")) {
    db.pragma('foreign_keys = OFF');
    const migrateUsers = db.transaction(() => {
      db.exec(`DROP TABLE IF EXISTS users_new`);
      db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'mockup' CHECK(role IN ('admin','mockup','trade')),
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
      db.exec(`
        INSERT INTO users_new (id, username, password, role, created_at)
          SELECT id, username, password,
            CASE WHEN role = 'user' THEN 'mockup' ELSE role END,
            created_at
          FROM users;
      `);
      db.exec(`DROP TABLE users`);
      db.exec(`ALTER TABLE users_new RENAME TO users`);
    });
    migrateUsers();
    db.pragma('foreign_keys = ON');
  }
} catch (e) {
  // ignore if already migrated
}

// ── Migration: add conversation_url to jobs (for regeneration feature) ─────
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN conversation_url TEXT`);
} catch (e) {
  // column already exists – ignore
}

// ── Migration: add previous_images to jobs (track old images on regenerate) ─────
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN previous_images TEXT`);
} catch (e) {
  // column already exists – ignore
}

// ── Migration: add disabled_at to gemini_accounts (for expiry notifications) ─────
try {
  db.exec(`ALTER TABLE gemini_accounts ADD COLUMN disabled_at TEXT`);
} catch (e) {
  // column already exists – ignore
}

// ── Migration: make prompt_id nullable in jobs (allow prompt deletion) ─────
try {
  const jobsSql = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'`
  ).get();
  if (jobsSql && jobsSql.sql && jobsSql.sql.includes('prompt_id INTEGER NOT NULL')) {
    db.pragma('foreign_keys = OFF');
    const migrateJobs = db.transaction(() => {
      db.exec(`DROP TABLE IF EXISTS jobs_new`);
      db.exec(`
        CREATE TABLE jobs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          batch_id TEXT,
          user_id INTEGER NOT NULL REFERENCES users(id),
          prompt_id INTEGER REFERENCES prompts(id),
          account_id INTEGER REFERENCES gemini_accounts(id),
          original_image TEXT NOT NULL,
          mockup_image TEXT,
          line_image TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','mockup_done','done','error')),
          error TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          retry_count INTEGER NOT NULL DEFAULT 0,
          conversation_url TEXT,
          previous_images TEXT
        )
      `);
      db.exec(`
        INSERT INTO jobs_new (id, batch_id, user_id, prompt_id, account_id, original_image,
          mockup_image, line_image, status, error, created_at, updated_at,
          retry_count, conversation_url, previous_images)
        SELECT id, batch_id, user_id, prompt_id, account_id, original_image,
          mockup_image, line_image, status, error, created_at, updated_at,
          retry_count, conversation_url, previous_images
        FROM jobs
      `);
      db.exec(`DROP TABLE jobs`);
      db.exec(`ALTER TABLE jobs_new RENAME TO jobs`);
    });
    migrateJobs();
    db.pragma('foreign_keys = ON');
  }
} catch (e) {
  // ignore if already migrated
}

module.exports = db;
