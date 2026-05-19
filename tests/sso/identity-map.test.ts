// MUST set the env var before importing anything that touches the DB module.
process.env.AUTH_DB_PATH = ':memory:';

import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, initAuthDb } from '@/lib/server/auth-db';
import {
  getCanonicalUser,
  resolveCanonical,
  upsertCanonical,
} from '@/lib/sso/identity-map';

function resetIdentityTables(): void {
  const db = getDb();
  db.exec('DROP TABLE IF EXISTS user_legacy_id');
  db.exec('DROP TABLE IF EXISTS user_identity_map');
  initAuthDb();
}

describe('sso/identity-map', () => {
  beforeEach(() => {
    resetIdentityTables();
  });

  it('round-trips upsert + getCanonicalUser', () => {
    upsertCanonical({
      canonicalEmail: 'instructor@school.edu',
      name: 'Inst Ructor',
      groups: ['_instructor'],
    });
    const user = getCanonicalUser('instructor@school.edu');
    expect(user).not.toBeNull();
    expect(user!.canonicalEmail).toBe('instructor@school.edu');
    expect(user!.name).toBe('Inst Ructor');
    expect(user!.groups).toEqual(['_instructor']);
  });

  it('resolves a direct canonical email', () => {
    upsertCanonical({ canonicalEmail: 'a@b.com' });
    expect(resolveCanonical('a@b.com')).toBe('a@b.com');
  });

  it('normalises canonical email to lowercase', () => {
    upsertCanonical({ canonicalEmail: 'Eric.Jackson@CoachingTheGist.com' });
    expect(getCanonicalUser('eric.jackson@coachingthegist.com')).not.toBeNull();
    expect(resolveCanonical('Eric.Jackson@CoachingTheGist.com')).toBe(
      'eric.jackson@coachingthegist.com',
    );
  });

  it('resolves a legacy id to canonical email', () => {
    upsertCanonical({
      canonicalEmail: 'eric@example.com',
      legacyIds: ['eric.jackson', 'zTctgRPUQ6gQjPGPW2WceDLsg12uifAS'],
    });
    expect(resolveCanonical('eric.jackson')).toBe('eric@example.com');
    expect(resolveCanonical('zTctgRPUQ6gQjPGPW2WceDLsg12uifAS')).toBe(
      'eric@example.com',
    );
  });

  it('returns input unchanged for unknown ids', () => {
    expect(resolveCanonical('nobody@nowhere')).toBe('nobody@nowhere');
    expect(resolveCanonical('some-legacy-hash')).toBe('some-legacy-hash');
  });

  it('upsert is idempotent and updates name + groups', () => {
    upsertCanonical({
      canonicalEmail: 'u@example.com',
      name: 'Old Name',
      groups: ['_student'],
    });
    upsertCanonical({
      canonicalEmail: 'u@example.com',
      name: 'New Name',
      groups: ['_instructor'],
    });
    const user = getCanonicalUser('u@example.com');
    expect(user!.name).toBe('New Name');
    expect(user!.groups).toEqual(['_instructor']);
  });

  it('preserves name when upsert omits it (COALESCE behaviour)', () => {
    upsertCanonical({ canonicalEmail: 'k@example.com', name: 'Kept' });
    upsertCanonical({ canonicalEmail: 'k@example.com', groups: ['_admin'] });
    const user = getCanonicalUser('k@example.com');
    expect(user!.name).toBe('Kept');
    expect(user!.groups).toEqual(['_admin']);
  });

  it('accumulates legacy ids across upserts (INSERT OR IGNORE)', () => {
    upsertCanonical({ canonicalEmail: 'a@x.com', legacyIds: ['id1'] });
    upsertCanonical({ canonicalEmail: 'a@x.com', legacyIds: ['id2'] });
    upsertCanonical({ canonicalEmail: 'a@x.com', legacyIds: ['id1'] }); // dup ignored
    expect(resolveCanonical('id1')).toBe('a@x.com');
    expect(resolveCanonical('id2')).toBe('a@x.com');
  });

  it('skips a legacy id that equals the canonical email', () => {
    upsertCanonical({
      canonicalEmail: 'same@x.com',
      legacyIds: ['same@x.com'],
    });
    const db = getDb();
    const count = (
      db
        .prepare('SELECT COUNT(*) AS n FROM user_legacy_id WHERE legacy_id = ?')
        .get('same@x.com') as { n: number }
    ).n;
    expect(count).toBe(0);
  });

  it('throws on empty canonicalEmail', () => {
    expect(() => upsertCanonical({ canonicalEmail: '   ' })).toThrow();
  });
});
