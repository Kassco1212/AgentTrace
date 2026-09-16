import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureSnapshot,
  findRepositoryRoot,
  getCurrentBranch,
  getHeadCommit,
  getSessionChanges,
  getStatus,
  isPathIgnored,
} from "../src/git/git";

let repoDir: string;

function git(args: string[], cwd = repoDir): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function writeFile(relPath: string, content: string): void {
  const fullPath = join(repoDir, relPath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content);
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "agenttrace-git-test-"));
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test User"]);
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("findRepositoryRoot", () => {
  test("returns the repo root when inside a repository", async () => {
    const root = await findRepositoryRoot(repoDir);
    // Resolve symlinks (macOS /tmp is a symlink) by comparing basenames of
    // the trailing path segment rather than exact string equality.
    expect(root).not.toBeNull();
    expect(root?.endsWith(repoDir.split("/").pop() ?? "")).toBe(true);
  });

  test("returns null outside any Git repository", async () => {
    const outside = mkdtempSync(join(tmpdir(), "agenttrace-not-a-repo-"));
    try {
      const root = await findRepositoryRoot(outside);
      expect(root).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("finds the root from a nested subdirectory", async () => {
    mkdirSync(join(repoDir, "src", "nested"), { recursive: true });
    const root = await findRepositoryRoot(join(repoDir, "src", "nested"));
    expect(root).not.toBeNull();
  });
});

describe("HEAD / branch reads", () => {
  test("getHeadCommit is null before any commit exists (Case D)", async () => {
    const commit = await getHeadCommit(repoDir);
    expect(commit).toBeNull();
  });

  test("getHeadCommit returns the SHA after a commit", async () => {
    writeFile("a.txt", "hello\n");
    git(["add", "a.txt"]);
    git(["commit", "-q", "-m", "initial"]);
    const commit = await getHeadCommit(repoDir);
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
  });

  test("getCurrentBranch reports the branch name", async () => {
    writeFile("a.txt", "hello\n");
    git(["add", "a.txt"]);
    git(["commit", "-q", "-m", "initial"]);
    const branch = await getCurrentBranch(repoDir);
    expect(branch).not.toBeNull();
  });

  test("getCurrentBranch is null on detached HEAD", async () => {
    writeFile("a.txt", "hello\n");
    git(["add", "a.txt"]);
    git(["commit", "-q", "-m", "initial"]);
    const commit = git(["rev-parse", "HEAD"]);
    git(["checkout", "-q", commit]);
    const branch = await getCurrentBranch(repoDir);
    expect(branch).toBeNull();
  });
});

describe("getStatus / isPathIgnored", () => {
  test("getStatus reflects untracked and modified files", async () => {
    writeFile("a.txt", "hello\n");
    git(["add", "a.txt"]);
    git(["commit", "-q", "-m", "initial"]);
    writeFile("a.txt", "modified\n");
    writeFile("b.txt", "new\n");
    const status = await getStatus(repoDir);
    expect(status).toContain("M a.txt");
    expect(status).toContain("?? b.txt");
  });

  test("isPathIgnored reflects .gitignore rules", async () => {
    writeFile(".gitignore", "ignored-dir/\n");
    expect(await isPathIgnored(repoDir, "ignored-dir/")).toBe(true);
    expect(await isPathIgnored(repoDir, "not-ignored/")).toBe(false);
  });
});

describe("getSessionChanges", () => {
  test("Case A: uncommitted modifications only", async () => {
    writeFile("a.txt", "hello\n");
    git(["add", "a.txt"]);
    git(["commit", "-q", "-m", "initial"]);

    const before = await captureSnapshot(repoDir);
    writeFile("a.txt", "hello\nmodified\n");
    writeFile("new.ts", "export const x = 1;\n");
    const after = await captureSnapshot(repoDir);

    const changes = await getSessionChanges(repoDir, before, after);
    const paths = changes.files.map((f) => f.path).sort();
    expect(paths).toEqual(["a.txt", "new.ts"]);
    expect(changes.files.length).toBeGreaterThan(0);
  });

  test("Case B: one or more commits created", async () => {
    writeFile("a.txt", "hello\n");
    git(["add", "a.txt"]);
    git(["commit", "-q", "-m", "initial"]);

    const before = await captureSnapshot(repoDir);
    writeFile("feature.ts", "export const feature = true;\n");
    git(["add", "feature.ts"]);
    git(["commit", "-q", "-m", "add feature"]);
    const after = await captureSnapshot(repoDir);

    expect(before.commit).not.toBe(after.commit);
    const changes = await getSessionChanges(repoDir, before, after);
    expect(changes.files.map((f) => f.path)).toEqual(["feature.ts"]);
    expect(changes.diffText.length).toBeGreaterThan(0);
    // Must not incorrectly report zero files changed when a commit happened.
    expect(changes.files.length).not.toBe(0);
  });

  test("Case C: commit plus remaining uncommitted modification", async () => {
    writeFile("a.txt", "hello\n");
    git(["add", "a.txt"]);
    git(["commit", "-q", "-m", "initial"]);

    const before = await captureSnapshot(repoDir);
    writeFile("committed.ts", "export const done = true;\n");
    git(["add", "committed.ts"]);
    git(["commit", "-q", "-m", "commit part"]);
    writeFile("draft.ts", "// wip\n");
    const after = await captureSnapshot(repoDir);

    const changes = await getSessionChanges(repoDir, before, after);
    const paths = changes.files.map((f) => f.path).sort();
    expect(paths).toEqual(["committed.ts", "draft.ts"]);
  });

  test("Case D: repository with no commits at all", async () => {
    const before = await captureSnapshot(repoDir);
    expect(before.commit).toBeNull();
    writeFile("first.ts", "export const first = 1;\n");
    const after = await captureSnapshot(repoDir);

    const changes = await getSessionChanges(repoDir, before, after);
    expect(changes.files.map((f) => f.path)).toEqual(["first.ts"]);
  });

  test("does not attribute pre-existing uncommitted changes to the session", async () => {
    writeFile("a.txt", "hello\n");
    writeFile("README.md", "# demo\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "initial"]);

    // Pre-existing modification, before the "session" starts.
    writeFile("README.md", "# demo\npre-existing edit\n");
    const before = await captureSnapshot(repoDir);

    // Session only touches a different file.
    writeFile("session-file.ts", "export const s = 1;\n");
    const after = await captureSnapshot(repoDir);

    const changes = await getSessionChanges(repoDir, before, after);
    const paths = changes.files.map((f) => f.path);
    expect(paths).toContain("session-file.ts");
    expect(paths).not.toContain("README.md");
  });
});
