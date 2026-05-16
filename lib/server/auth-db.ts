/**
 * Auth Database — Server-only SQLite module
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';

const DB_PATH = process.env.AUTH_DB_PATH || '/app/data/auth/auth.db';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

export function initBetterAuthTables(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      role TEXT NOT NULL DEFAULT 'student',
      institution TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS "session" (
      id TEXT PRIMARY KEY,
      expiresAt TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      userId TEXT NOT NULL,
      ipAddress TEXT,
      userAgent TEXT,
      FOREIGN KEY (userId) REFERENCES "user"(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS "account" (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      providerId TEXT NOT NULL,
      userId TEXT NOT NULL,
      accessToken TEXT,
      refreshToken TEXT,
      idToken TEXT,
      accessTokenExpiresAt TEXT,
      refreshTokenExpiresAt TEXT,
      scope TEXT,
      password TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES "user"(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS "verification" (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_session_token   ON "session"(token);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_session_userId  ON "session"(userId);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_account_userId  ON "account"(userId);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_email      ON "user"(email);`);

  // Idempotent column migrations
  try { db.exec(`ALTER TABLE "user" ADD COLUMN preferences TEXT;`); } catch { /* already exists */ }

  console.log('[Auth] better-auth core tables initialized');
}

export function initAuthDb(): void {
  const db = getDb();

  initBetterAuthTables();

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_providers (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      providerSlug TEXT NOT NULL,
      encryptedApiKey TEXT NOT NULL,
      defaultModel TEXT,
      limits TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      UNIQUE(userId, providerSlug)
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_providers_userId ON user_providers(userId);`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      providerSlug TEXT NOT NULL,
      model TEXT NOT NULL,
      inputTokens INTEGER DEFAULT 0,
      outputTokens INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_logs_userId    ON usage_logs(userId);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_logs_createdAt ON usage_logs(createdAt);`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS classroom_audit_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      classroom_id    TEXT    NOT NULL,
      changed_by      TEXT    NOT NULL,
      changed_by_name TEXT,
      changed_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      action          TEXT    NOT NULL,
      field           TEXT,
      old_value       TEXT,
      new_value       TEXT,
      reason          TEXT
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_classroom ON classroom_audit_log(classroom_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_changed_at ON classroom_audit_log(changed_at);`);

  console.log('[Auth] Extension database initialized at', DB_PATH);
}
