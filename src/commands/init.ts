// `agenttrace init` — idempotent: creates .agenttrace/, the SQLite
// database + schema, and ensures .agenttrace/ is Git-ignored, without
// disturbing anything that already exists.

import { existsSync, appendFileSync, readFileSync } from "node:fs";
import { findRepositoryRoot, isGitInstalled, isPathIgnored } from "../git/git";
import { databasePath, openDatabase } from "../db/database";
import { bold } from "../output/format";

export async function runInit(): Promise<void> {
  if (!isGitInstalled()) {
    console.error("Git was not found in PATH.\nInstall Git and try again.");
    process.exitCode = 1;
    return;
  }

  const repoRoot = await findRepositoryRoot(process.cwd());
  if (!repoRoot) {
    console.error("Git repository not found.\nAgentTrace must be run inside a Git repository.");
    process.exitCode = 1;
    return;
  }

  // Creating the directory + database + schema is naturally idempotent:
  // openDatabase() creates-if-missing and initializeDatabase() only ever
  // CREATE TABLE IF NOT EXISTS.
  const dbPath = databasePath(repoRoot);
  const db = openDatabase(dbPath);
  db.close();

  const gitignorePath = `${repoRoot}/.gitignore`;
  const alreadyIgnored = await isPathIgnored(repoRoot, ".agenttrace/");
  let ignoreMessage: string;

  if (alreadyIgnored) {
    ignoreMessage = ".agenttrace/ is already ignored by Git";
  } else {
    const entry = ".agenttrace/";
    if (existsSync(gitignorePath)) {
      const existing = readFileSync(gitignorePath, "utf8");
      const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
      appendFileSync(gitignorePath, `${needsLeadingNewline ? "\n" : ""}${entry}\n`);
    } else {
      appendFileSync(gitignorePath, `${entry}\n`);
    }
    ignoreMessage = ".agenttrace/ added to .gitignore";
  }

  console.log(bold("AgentTrace initialized."));
  console.log("Database:");
  console.log(`  ${dbPath}`);
  console.log(ignoreMessage);
}
