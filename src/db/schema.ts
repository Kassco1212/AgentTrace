// SQLite schema for AgentTrace. No ORM — direct SQL with prepared
// statements. Schema versioning is intentionally minimal: a single integer
// row in `schema_version`, bumped only if the schema ever needs to change.

import type { Database } from "bun:sqlite";

export const CURRENT_SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    prompt TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    branch TEXT,
    start_commit TEXT,
    end_commit TEXT,
    start_status TEXT,
    end_status TEXT,
    stdout TEXT,
    stderr TEXT,
    diff_text TEXT,
    additions INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0,
    files_changed INTEGER NOT NULL DEFAULT 0,
    exit_code INTEGER,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS file_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    path TEXT NOT NULL,
    status TEXT NOT NULL,
    additions INTEGER,
    deletions INTEGER,
    FOREIGN KEY(session_id)
        REFERENCES sessions(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at
ON sessions(started_at);

CREATE INDEX IF NOT EXISTS idx_sessions_agent
ON sessions(agent);

CREATE INDEX IF NOT EXISTS idx_file_changes_session_id
ON file_changes(session_id);
`;

/**
 * Creates required tables if missing and reconciles the schema_version row.
 * Throws if the database reports a newer schema version than this build of
 * AgentTrace understands, rather than silently corrupting data.
 */
export function initializeDatabase(db: Database): void {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA_SQL);

  const row = db.query("SELECT version FROM schema_version LIMIT 1").get() as
    | { version: number }
    | null;

  if (row === null) {
    db.query("INSERT INTO schema_version (version) VALUES (?)").run(CURRENT_SCHEMA_VERSION);
    return;
  }

  if (row.version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${row.version} is newer than this AgentTrace build supports ` +
        `(expected ${CURRENT_SCHEMA_VERSION}). Upgrade AgentTrace and try again.`,
    );
  }
  // row.version < CURRENT_SCHEMA_VERSION would be handled by a migration
  // step here; there is only one schema version so far.
}
