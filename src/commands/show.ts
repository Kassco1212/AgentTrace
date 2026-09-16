// `agenttrace show <id>` — full detail view of one recorded session.

import { existsSync } from "node:fs";
import { databasePath, openDatabase } from "../db/database";
import { getFileChanges, getSession } from "../db/sessions";
import { findRepositoryRoot, isGitInstalled } from "../git/git";
import { formatSessionDetail } from "../output/format";

export interface ShowOptions {
  id: number;
  diff: boolean;
  noTranscript: boolean;
}

export async function runShow(options: ShowOptions): Promise<void> {
  if (!isGitInstalled()) {
    console.error("Git executable unavailable.\nInstall Git and try again.");
    process.exitCode = 1;
    return;
  }

  const repoRoot = await findRepositoryRoot(process.cwd());
  if (!repoRoot) {
    console.error("Git repository not found.\nAgentTrace must be run inside a Git repository.");
    process.exitCode = 1;
    return;
  }

  const dbPath = databasePath(repoRoot);
  if (!existsSync(dbPath)) {
    console.error("AgentTrace is not initialized.\nRun:\n  agenttrace init");
    process.exitCode = 1;
    return;
  }

  if (!Number.isInteger(options.id) || options.id <= 0) {
    console.error(`Invalid session ID: ${options.id}`);
    process.exitCode = 1;
    return;
  }

  const db = openDatabase(dbPath);
  try {
    const session = getSession(db, options.id);
    if (!session) {
      console.error(`Session #${options.id} not found.`);
      process.exitCode = 1;
      return;
    }

    const fileChanges = getFileChanges(db, options.id);
    console.log(
      formatSessionDetail(session, fileChanges, {
        includeDiff: options.diff,
        includeTranscript: !options.noTranscript,
      }),
    );
  } finally {
    db.close();
  }
}
