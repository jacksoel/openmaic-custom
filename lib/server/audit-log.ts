import { getDb } from './auth-db';

export type AuditAction = 'visibility_change' | 'enrollment_change' | 'metadata_edit';

export interface AuditLogEntry {
  id: number;
  classroomId: string;
  changedBy: string;
  changedByName: string | null;
  changedAt: string;
  action: AuditAction;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
}

export function appendAuditLog(entry: {
  classroomId: string;
  changedBy: string;
  changedByName?: string | null;
  action: AuditAction;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO classroom_audit_log
      (classroom_id, changed_by, changed_by_name, action, field, old_value, new_value, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.classroomId,
    entry.changedBy,
    entry.changedByName ?? null,
    entry.action,
    entry.field ?? null,
    entry.oldValue !== undefined ? JSON.stringify(entry.oldValue) : null,
    entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
    entry.reason ?? null,
  );
}

export function getClassroomHistory(
  classroomId: string,
  limit = 50,
  offset = 0,
): AuditLogEntry[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      id,
      classroom_id    AS classroomId,
      changed_by      AS changedBy,
      changed_by_name AS changedByName,
      changed_at      AS changedAt,
      action,
      field,
      old_value       AS oldValue,
      new_value       AS newValue,
      reason
    FROM classroom_audit_log
    WHERE classroom_id = ?
    ORDER BY changed_at DESC
    LIMIT ? OFFSET ?
  `).all(classroomId, limit, offset) as AuditLogEntry[];
}
