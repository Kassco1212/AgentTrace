// `agenttrace run <agent> --prompt "..."` — records one coding-agent
// session: validate environment, snapshot Git, run the agent (streaming
// output live), snapshot Git again, compute changes, persist everything.

import { existsSync } from "node:fs";
import { databasePath, openDatabase } from "../db/database";
import { addFileChanges, createSession, finishSession, getSession } from "../db/sessions";
import { captureSnapshot, findRepositoryRoot, getSessionChanges, isGitInstalled } from "../git/git";
import { getAgentAdapter, SUPPORTED_AGENTS } from "../agents/registry";
import { runAgentProcess } from "../utils/process";
import { nowIso, formatDuration } from "../utils/time";
import { redactSecrets } from "../security/redact";
import { formatRunSummary, shortCommit } from "../output/format";
import type { SessionStatus } from "../types";

export interface RunOptions {
  agent: string;
  prompt: string;
}

export async function runRun(options: RunOptions): Promise<void> {
  const { agent: agentName, prompt } = options;

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

  const adapter = getAgentAdapter(agentName);
  if (!adapter) {
    console.error(
      `Unknown coding agent: ${agentName}\nSupported agents:\n${SUPPORTED_AGENTS.map((a) => `  ${a}`).join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }

  if (!adapter.isInstalled()) {
    console.error(adapter.notInstalledMessage());
    process.exitCode = 1;
    return;
  }

  if (!prompt || prompt.trim().length === 0) {
    console.error("A prompt is required.\nExample:\n  agenttrace run claude --prompt \"Fix the failing tests\"");
    process.exitCode = 1;
    return;
  }

  const db = openDatabase(dbPath);

  try {
    const before = await captureSnapshot(repoRoot);
    const startedAt = nowIso();

    const sessionId = createSession(db, {
      agent: adapter.name,
      prompt: redactSecrets(prompt),
      repositoryPath: repoRoot,
      branch: before.branch,
      startCommit: before.commit,
      startStatus: before.status,
      startedAt,
    });

    console.log("AgentTrace");
    console.log("Recording session...");
    console.log(`Agent:       ${adapter.name}`);
    console.log(`Branch:      ${before.branch ?? "detached HEAD"}`);
    console.log(`Base commit: ${shortCommit(before.commit)}`);
    console.log("\u2500".repeat(36));

    const command = adapter.buildCommand(prompt);
    const startTime = Date.now();
    const result = await runAgentProcess(command.executable, command.args, repoRoot);
    const durationMs = Date.now() - startTime;

    console.log("\u2500".repeat(36));

    const after = await captureSnapshot(repoRoot);
    const changes = await getSessionChanges(repoRoot, before, after);

    let status: SessionStatus;
    if (result.interrupted) {
      status = "interrupted";
    } else if (result.exitCode === 0) {
      status = "completed";
    } else {
      status = "failed";
    }

    const endedAt = nowIso();
    finishSession(db, {
      id: sessionId,
      endCommit: after.commit,
      endStatus: after.status,
      stdout: redactSecrets(result.stdout),
      stderr: redactSecrets(result.stderr),
      diffText: redactSecrets(changes.diffText),
      additions: changes.additions,
      deletions: changes.deletions,
      filesChanged: changes.files.length,
      exitCode: result.exitCode,
      status,
      endedAt,
      durationMs,
    });

    if (changes.files.length > 0) {
      addFileChanges(
        db,
        sessionId,
        changes.files.map((f) => ({
          sessionId,
          path: f.path,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
        })),
      );
    }

    const session = getSession(db, sessionId);
    if (session) {
      console.log(formatRunSummary(session));
      console.log(`Saved to ${dbPath}`);
    }

    if (status === "interrupted") {
      console.error(`\nSession #${sessionId} interrupted (${formatDuration(durationMs)}).`);
      process.exitCode = 130;
    } else if (status === "failed") {
      process.exitCode = result.exitCode && result.exitCode !== 0 ? result.exitCode : 1;
    }
  } finally {
    db.close();
  }
}
