// Opens (and, if needed, creates) the AgentTrace SQLite database.

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { initializeDatabase } from "./schema";

export const AGENTTRACE_DIR_NAME = ".agenttrace";
export const DB_FILE_NAME = "agenttrace.db";

export function agenttraceDirPath(repoRoot: string): string {
  return `${repoRoot}/${AGENTTRACE_DIR_NAME}`;
}

export function databasePath(repoRoot: string): string {
  return `${agenttraceDirPath(repoRoot)}/${DB_FILE_NAME}`;
}

/** Opens the database at `path`, creating parent directories and the schema
 * if this is the first time AgentTrace has run in this repository. */
export function openDatabase(path: string): Database {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(path, { create: true });
  initializeDatabase(db);
  return db;
}
