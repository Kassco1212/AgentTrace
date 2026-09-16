// `agenttrace list` — recent sessions, newest first.

import { existsSync } from "node:fs";
import { databasePath, openDatabase } from "../db/database";
import { listSessions, markStaleRunningSessionsInterrupted } from "../db/sessions";
import { findRepositoryRoot, isGitInstalled } from "../git/git";
import { formatSessionTable } from "../output/format";

export interface ListOptions {
  limit: number;
  agent?: string;
}

export async function runList(options: ListOptions): Promise<void> {
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

  const db = openDatabase(dbPath);
  try {
    markStaleRunningSessionsInterrupted(db);
    const sessions = listSessions(db, { limit: options.limit, agent: options.agent });

    if (sessions.length === 0) {
      console.log("No AgentTrace sessions recorded yet.");
      console.log('Run a coding agent with:');
      console.log('  agenttrace run claude --prompt "..."');
      return;
    }

    console.log(formatSessionTable(sessions));
  } finally {
    db.close();
  }
}
