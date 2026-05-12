/**
 * Usage Logger — Server-side LLM call tracking
 *
 * Phase 4.1: Records every LLM call to the usage_logs table in auth.db.
 * Called from API routes after each LLM call completes.
 *
 * Schema (already initialized in auth-db.ts):
 *   id TEXT PRIMARY KEY,
 *   userId TEXT NOT NULL,
 *   providerSlug TEXT NOT NULL,
 *   model TEXT NOT NULL,
 *   inputTokens INTEGER DEFAULT 0,
 *   outputTokens INTEGER DEFAULT 0,
 *   createdAt TEXT DEFAULT (datetime('now'))
 */

import { getDb } from './auth-db';
import { createLogger } from '@/lib/logger';
import { randomUUID } from 'crypto';

const log = createLogger('UsageLogger');

export interface UsageLogEntry {
  userId: string;
  providerSlug: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Log a single LLM usage event.
 *
 * This is designed to be called after an LLM call completes (either success or
 * partial success). It writes to the auth.db SQLite synchronously via
 * better-sqlite3, which is safe in a Next.js server context.
 *
 * Errors in logging are caught and reported but never crash the request —
 * usage logging is best-effort, never blocking.
 */
export function logUsage(entry: UsageLogEntry): void {
  try {
    const db = getDb();
    const id = randomUUID();

    db.prepare(
      `INSERT INTO usage_logs (id, userId, providerSlug, model, inputTokens, outputTokens, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(id, entry.userId, entry.providerSlug, entry.model, entry.inputTokens, entry.outputTokens);

    log.info(`Usage logged: user=${entry.userId} provider=${entry.providerSlug} model=${entry.model} in=${entry.inputTokens} out=${entry.outputTokens}`);
  } catch (error) {
    // Best-effort: never crash the request over logging failures
    log.error('Failed to log usage:', error);
  }
}

/**
 * Log usage asynchronously (fire-and-forget).
 *
 * Uses Next.js `after()` to defer the write until after the response is sent,
 * so it doesn't add latency to the user's request.
 */
export function logUsageDeferred(entry: UsageLogEntry): void {
  try {
    // Dynamic import of Next.js 'after' — falls back to sync if not available
    const { after } = require('next/server');
    after(() => logUsage(entry));
  } catch {
    // Fallback: log synchronously if after() is unavailable
    logUsage(entry);
  }
}

/**
 * Query usage logs with optional filters.
 *
 * Returns aggregated or raw usage data for the admin dashboard.
 */
export interface UsageQuery {
  userId?: string;
  providerSlug?: string;
  model?: string;
  startDate?: string; // ISO date string
  endDate?: string;   // ISO date string
  limit?: number;
  offset?: number;
  groupBy?: 'userId' | 'providerSlug' | 'model' | 'day';
}

export interface UsageRow {
  id: string;
  userId: string;
  providerSlug: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

export interface UsageAggregate {
  key: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
}

export function queryUsage(query: UsageQuery): UsageRow[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (query.userId) {
    conditions.push('userId = ?');
    params.push(query.userId!);
  }
  if (query.providerSlug) {
    conditions.push('providerSlug = ?');
    params.push(query.providerSlug!);
  }
  if (query.model) {
    conditions.push('model = ?');
    params.push(query.model!);
  }
  if (query.startDate) {
    conditions.push('createdAt >= ?');
    params.push(query.startDate!);
  }
  if (query.endDate) {
    conditions.push('createdAt <= ?');
    params.push(query.endDate!);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;

  const rows = db.prepare(
    `SELECT * FROM usage_logs ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all() as UsageRow[];

  return rows;
}

export function aggregateUsage(query: UsageQuery): UsageAggregate[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (query.userId) {
    conditions.push('userId = ?');
    params.push(query.userId!);
  }
  if (query.providerSlug) {
    conditions.push('providerSlug = ?');
    params.push(query.providerSlug!);
  }
  if (query.model) {
    conditions.push('model = ?');
    params.push(query.model!);
  }
  if (query.startDate) {
    conditions.push('createdAt >= ?');
    params.push(query.startDate!);
  }
  if (query.endDate) {
    conditions.push('createdAt <= ?');
    params.push(query.endDate!);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const groupBy = query.groupBy ?? 'userId';
  let selectKey: string;
  switch (groupBy) {
    case 'day':
      selectKey = "date(createdAt) as key";
      break;
    case 'providerSlug':
      selectKey = 'providerSlug as key';
      break;
    case 'model':
      selectKey = 'model as key';
      break;
    case 'userId':
    default:
      selectKey = 'userId as key';
      break;
  }

  const rows = db.prepare(
    `SELECT ${selectKey}, SUM(inputTokens) as totalInputTokens, SUM(outputTokens) as totalOutputTokens, COUNT(*) as totalCalls
     FROM usage_logs ${where}
     GROUP BY key
     ORDER BY totalCalls DESC`
  ).bind(...params).all() as UsageAggregate[];

  return rows;
}
