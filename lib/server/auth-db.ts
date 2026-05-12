/**
 * Auth Database — Server-only SQLite module
 *
 * Handles database initialization and direct queries for
 * better-auth tables and extension tables (user_providers, usage_logs).
 *
 * This module uses better-sqlite3 (Node.js native) and
 * must only be imported from server-side code.
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.AUTH_DB_PATH || '/app/data/auth/auth.db';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

/**
 * Initialize better-auth core tables.
 * These must exist before better-auth can function.
 */
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

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_session_token ON "session"(token);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_session_userId ON "session"(userId);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_account_userId ON "account"(userId);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_email ON "user"(email);`);

  console.log('[Auth] better-auth core tables initialized');
}

/**
 * Initialize extension tables (user_providers, usage_logs).
 * Called once at server startup.
 */
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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_providers_userId
    ON user_providers(userId);
  `);

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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_usage_logs_userId
    ON usage_logs(userId);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_usage_logs_createdAt
    ON usage_logs(createdAt);
  `);

  console.log('[Auth] Extension database initialized at', DB_PATH);
}