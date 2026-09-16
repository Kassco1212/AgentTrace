// Database operations for sessions and file_changes. All SQL lives here —
// callers (commands/, output/) never touch SQL directly. Every statement
// is prepared and every value is bound, never interpolated.

import type { Database } from "bun:sqlite";
import type {
  FileChangeRecord,
  FinishSessionInput,
  NewSessionInput,
  SessionRecord,
  SessionStatus,
} from "../types";

interface SessionRow {
  id: number;
  agent: string;
  prompt: string;
  repository_path: string;
  branch: string | null;
  start_commit: string | null;
  end_commit: string | null;
  start_status: string | null;
  end_status: string | null;
  stdout: string | null;
  stderr: string | null;
  diff_text: string | null;
  additions: number;
  deletions: number;
  files_changed: number;
  exit_code: number | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
}

function rowToRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    agent: row.agent,
    prompt: row.prompt,
    repositoryPath: row.repository_path,
    branch: row.branch,
    startCommit: row.start_commit,
    endCommit: row.end_commit,
    startStatus: row.start_status,
    endStatus: row.end_status,
    stdout: row.stdout,
    stderr: row.stderr,
    diffText: row.diff_text,
    additions: row.additions,
    deletions: row.deletions,
    filesChanged: row.files_changed,
    exitCode: row.exit_code,
    status: row.status as SessionStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
  };
}

/** Inserts a new session row with status "running", before the agent
 * starts. Returns the generated session ID. */
export function createSession(db: Database, input: NewSessionInput): number {
  const stmt = db.query(`
    INSERT INTO sessions (
      agent, prompt, repository_path, branch, start_commit, start_status, status, started_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
  `);
  const result = stmt.run(
    input.agent,
    input.prompt,
    input.repositoryPath,
    input.branch,
    input.startCommit,
    input.startStatus,
    input.startedAt,
  );
  return Number(result.lastInsertRowid);
}

/** Finalizes a session row after the agent has exited (or been
 * interrupted). */
export function finishSession(db: Database, input: FinishSessionInput): void {
  const stmt = db.query(`
    UPDATE sessions SET
      end_commit = ?,
      end_status = ?,
      stdout = ?,
      stderr = ?,
      diff_text = ?,
      additions = ?,
      deletions = ?,
      files_changed = ?,
      exit_code = ?,
      status = ?,
      ended_at = ?,
      duration_ms = ?
    WHERE id = ?
  `);
  stmt.run(
    input.endCommit,
    input.endStatus,
    input.stdout,
    input.stderr,
    input.diffText,
    input.additions,
    input.deletions,
    input.filesChanged,
    input.exitCode,
    input.status,
    input.endedAt,
    input.durationMs,
    input.id,
  );
}

/** Replaces the file_changes rows for a session (called once, after the
 * session is finalized). */
export function addFileChanges(db: Database, sessionId: number, files: FileChangeRecord[]): void {
  if (files.length === 0) return;
  const stmt = db.query(`
    INSERT INTO file_changes (session_id, path, status, additions, deletions)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertAll = db.transaction((rows: FileChangeRecord[]) => {
    for (const row of rows) {
      stmt.run(sessionId, row.path, row.status, row.additions, row.deletions);
    }
  });
  insertAll(files);
}

export function getSession(db: Database, id: number): SessionRecord | null {
  const row = db.query("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | null;
  return row ? rowToRecord(row) : null;
}

export function getFileChanges(db: Database, sessionId: number): FileChangeRecord[] {
  const rows = db
    .query("SELECT * FROM file_changes WHERE session_id = ? ORDER BY id ASC")
    .all(sessionId) as Array<{
    id: number;
    session_id: number;
    path: string;
    status: string;
    additions: number | null;
    deletions: number | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    path: row.path,
    status: row.status,
    additions: row.additions,
    deletions: row.deletions,
  }));
}

export interface ListSessionsOptions {
  limit: number;
  agent?: string;
}

export function listSessions(db: Database, options: ListSessionsOptions): SessionRecord[] {
  const rows = options.agent
    ? (db
        .query("SELECT * FROM sessions WHERE agent = ? ORDER BY started_at DESC LIMIT ?")
        .all(options.agent, options.limit) as SessionRow[])
    : (db
        .query("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?")
        .all(options.limit) as SessionRow[]);
  return rows.map(rowToRecord);
}

/** Default staleness threshold: a "running" session older than this is
 * assumed to belong to an AgentTrace process that was killed in a way it
 * could not handle (e.g. SIGKILL), rather than one genuinely in progress
 * right now. Deliberately simple — no daemon, no heartbeat, no lock file. */
const STALE_RUNNING_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Marks sessions still marked "running" as "interrupted" once they are
 * obviously stale (older than the threshold). A session genuinely in
 * progress in another terminal is left untouched. Best-effort only — see
 * spec: crash recovery. */
export function markStaleRunningSessionsInterrupted(
  db: Database,
  thresholdMs: number = STALE_RUNNING_THRESHOLD_MS,
): number {
  const cutoffIso = new Date(Date.now() - thresholdMs).toISOString();
  const nowIso = new Date().toISOString();
  const stmt = db.query(`
    UPDATE sessions SET status = 'interrupted', ended_at = COALESCE(ended_at, ?)
    WHERE status = 'running' AND started_at < ?
  `);
  const result = stmt.run(nowIso, cutoffIso);
  return result.changes;
}
