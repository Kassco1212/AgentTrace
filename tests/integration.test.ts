// Exercises AgentTrace's own machinery end-to-end — process execution,
// Git before/after snapshotting, change computation, and SQLite
// persistence — using a fake local script instead of a real Claude Code or
// Codex process (which may not be installed/authenticated here).

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeDatabase } from "../src/db/schema";
import { addFileChanges, createSession, finishSession, getFileChanges, getSession } from "../src/db/sessions";
import { captureSnapshot, getSessionChanges } from "../src/git/git";
import { runAgentProcess } from "../src/utils/process";
import { redactSecrets } from "../src/security/redact";

let repoDir: string;
let scriptPath: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8" }).trim();
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "agenttrace-integration-"));
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test User"]);
  writeFileSync(join(repoDir, "README.md"), "# demo\n");
  git(["add", "README.md"]);
  git(["commit", "-q", "-m", "initial"]);

  scriptPath = join(repoDir, "..", "fake-agent.sh");
  writeFileSync(
    scriptPath,
    [
      "#!/usr/bin/env bash",
      'echo "fake-agent: starting"',
      'echo "OPENAI_API_KEY=sk-should-be-redacted"',
      `cat > ${JSON.stringify(join(repoDir, "hello.ts"))} << 'FILE'`,
      'export function hello(): void { console.log("hi"); }',
      "FILE",
      'echo "fake-agent: done"',
      "exit 0",
    ].join("\n"),
  );
  chmodSync(scriptPath, 0o755);
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
  rmSync(scriptPath, { force: true });
});

test("full session lifecycle: run -> snapshot -> persist -> read back", async () => {
  const db = new Database(":memory:");
  initializeDatabase(db);

  const before = await captureSnapshot(repoDir);
  const sessionId = createSession(db, {
    agent: "claude",
    prompt: "Create hello.ts",
    repositoryPath: repoDir,
    branch: before.branch,
    startCommit: before.commit,
    startStatus: before.status,
    startedAt: new Date().toISOString(),
  });
  expect(sessionId).toBeGreaterThan(0);
  expect(getSession(db, sessionId)?.status).toBe("running");

  const result = await runAgentProcess(scriptPath, [], repoDir);
  expect(result.exitCode).toBe(0);
  expect(result.interrupted).toBe(false);
  expect(result.stdout).toContain("fake-agent: starting");
  expect(result.stdout).toContain("fake-agent: done");

  const after = await captureSnapshot(repoDir);
  const changes = await getSessionChanges(repoDir, before, after);
  expect(changes.files.map((f) => f.path)).toEqual(["hello.ts"]);

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
    status: "completed",
    endedAt: new Date().toISOString(),
    durationMs: 42,
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

  const finalSession = getSession(db, sessionId);
  expect(finalSession?.status).toBe("completed");
  expect(finalSession?.filesChanged).toBe(1);
  expect(finalSession?.exitCode).toBe(0);
  // Secret that appeared in captured stdout must never reach storage.
  expect(finalSession?.stdout).not.toContain("sk-should-be-redacted");
  expect(finalSession?.stdout).toContain("[REDACTED]");

  const fileChanges = getFileChanges(db, sessionId);
  expect(fileChanges.length).toBe(1);
  expect(fileChanges[0]?.path).toBe("hello.ts");

  db.close();
});

test("failed agent run is still recorded, not lost", async () => {
  writeFileSync(scriptPath, ["#!/usr/bin/env bash", 'echo "about to fail" >&2', "exit 1"].join("\n"));
  chmodSync(scriptPath, 0o755);

  const db = new Database(":memory:");
  initializeDatabase(db);
  const before = await captureSnapshot(repoDir);
  const sessionId = createSession(db, {
    agent: "codex",
    prompt: "Do something that fails",
    repositoryPath: repoDir,
    branch: before.branch,
    startCommit: before.commit,
    startStatus: before.status,
    startedAt: new Date().toISOString(),
  });

  const result = await runAgentProcess(scriptPath, [], repoDir);
  expect(result.exitCode).toBe(1);

  const after = await captureSnapshot(repoDir);
  const changes = await getSessionChanges(repoDir, before, after);

  finishSession(db, {
    id: sessionId,
    endCommit: after.commit,
    endStatus: after.status,
    stdout: result.stdout,
    stderr: result.stderr,
    diffText: changes.diffText,
    additions: changes.additions,
    deletions: changes.deletions,
    filesChanged: changes.files.length,
    exitCode: result.exitCode,
    status: "failed",
    endedAt: new Date().toISOString(),
    durationMs: 10,
  });

  const session = getSession(db, sessionId);
  expect(session?.status).toBe("failed");
  expect(session?.exitCode).toBe(1);
  expect(session?.stderr).toContain("about to fail");
  db.close();
});
