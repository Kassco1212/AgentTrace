// Read-only Git inspection layer.
//
// AgentTrace only ever *reads* Git state. The one documented exception is
// `agenttrace init`, which may append a line to .gitignore. Every function
// here must remain non-mutating (see "Git must be read-only" in the spec).
//
// All external processes are spawned with Bun.spawn using argument arrays —
// never a shell string — so user-controlled content (paths, prompts) can
// never be interpreted as shell syntax.

import type { FileChange, GitSnapshot, SessionChanges } from "./types";

/** SHA of the canonical empty Git tree. Used to diff against "nothing" when
 * a repository has no commits yet (Case D in the spec). */
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runGit(args: string[], cwd: string): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // Deliberately NOT trimmed here: `git status --porcelain` output is
  // structurally significant on its leading character (a leading space in
  // " M path" distinguishes "modified, unstaged" from other codes), so a
  // blanket .trim() on the whole string would corrupt the first line.
  // Callers trim exactly what is safe to trim for their own output shape.
  return { stdout, stderr: stderr.trimEnd(), exitCode };
}

/** True if `git` itself is reachable on PATH. */
export function isGitInstalled(): boolean {
  return Bun.which("git") !== null;
}

/** Finds the repository root for `cwd`, or null if `cwd` is not inside a
 * Git repository (or Git is not installed). */
export async function findRepositoryRoot(cwd: string): Promise<string | null> {
  if (!isGitInstalled()) return null;
  const result = await runGit(["rev-parse", "--show-toplevel"], cwd);
  if (result.exitCode !== 0) return null;
  return result.stdout.trim();
}

/** Current HEAD commit SHA, or null if the repository has no commits yet
 * (Case D) or HEAD cannot be resolved. */
export async function getHeadCommit(repoRoot: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "HEAD"], repoRoot);
  if (result.exitCode !== 0) return null;
  return result.stdout.trim();
}

/** Current branch name, or null when HEAD is detached (or unresolvable). */
export async function getCurrentBranch(repoRoot: string): Promise<string | null> {
  const result = await runGit(["branch", "--show-current"], repoRoot);
  if (result.exitCode !== 0) return null;
  const branch = result.stdout.trim();
  return branch.length > 0 ? branch : null;
}

/** Raw `git status --porcelain=v1` output (trailing newline stripped only
 * — leading characters are structurally significant, see runGit). */
export async function getStatus(repoRoot: string): Promise<string> {
  const result = await runGit(["status", "--porcelain=v1"], repoRoot);
  return result.stdout.replace(/\n+$/, "");
}

/** True if `relPath` is already covered by a .gitignore rule (or other
 * Git ignore mechanism). Used only to decide whether `init` needs to
 * append a line to .gitignore — never to change repository state. */
export async function isPathIgnored(repoRoot: string, relPath: string): Promise<boolean> {
  const result = await runGit(["check-ignore", "-q", relPath], repoRoot);
  return result.exitCode === 0;
}

/** Captures a full before/after snapshot: root, branch, HEAD commit, status. */
export async function captureSnapshot(repoRoot: string): Promise<GitSnapshot> {
  const [commit, branch, status] = await Promise.all([
    getHeadCommit(repoRoot),
    getCurrentBranch(repoRoot),
    getStatus(repoRoot),
  ]);
  return { repositoryRoot: repoRoot, commit, branch, status };
}

/** Parses `git status --porcelain=v1` text into path -> two-letter status
 * code, resolving rename entries ("old -> new") to the new path. Used only
 * for best-effort before/after attribution, never for diff content. */
function parsePorcelainMap(status: string): Map<string, string> {
  const map = new Map<string, string>();
  if (status.length === 0) return map;
  for (const line of status.split("\n")) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    let rest = line.slice(3);
    if (rest.includes(" -> ")) {
      const parts = rest.split(" -> ");
      rest = parts[parts.length - 1] ?? rest;
    }
    // Porcelain quotes paths with unusual characters in double quotes.
    if (rest.startsWith('"') && rest.endsWith('"')) {
      rest = rest.slice(1, -1);
    }
    map.set(rest, code);
  }
  return map;
}

interface NameStatusEntry {
  code: string;
  path: string;
}

/** `git diff --name-status <args>`, parsed into status code + resolved path
 * (renames are rendered as "old \u2192 new" per the spec's example output). */
async function diffNameStatus(repoRoot: string, args: string[]): Promise<NameStatusEntry[]> {
  const result = await runGit(["diff", "--name-status", ...args], repoRoot);
  const trimmed = result.stdout.trimEnd();
  if (trimmed.length === 0) return [];
  const entries: NameStatusEntry[] = [];
  for (const line of trimmed.split("\n")) {
    const cols = line.split("\t");
    const code = cols[0] ?? "";
    if (code.startsWith("R") || code.startsWith("C")) {
      const oldPath = cols[1] ?? "";
      const newPath = cols[2] ?? oldPath;
      entries.push({ code: code[0] ?? "R", path: `${oldPath} \u2192 ${newPath}` });
    } else {
      entries.push({ code, path: cols[1] ?? "" });
    }
  }
  return entries;
}

interface NumstatEntry {
  additions: number | null;
  deletions: number | null;
  path: string;
}

/** `git diff --numstat <args>`, parsed into add/delete counts per path.
 * Binary files report "-" for both counts, mapped to null per spec. */
async function diffNumstat(repoRoot: string, args: string[]): Promise<NumstatEntry[]> {
  const result = await runGit(["diff", "--numstat", ...args], repoRoot);
  const trimmed = result.stdout.trimEnd();
  if (trimmed.length === 0) return [];
  const entries: NumstatEntry[] = [];
  for (const line of trimmed.split("\n")) {
    const cols = line.split("\t");
    const addRaw = cols[0] ?? "-";
    const delRaw = cols[1] ?? "-";
    let path = cols[2] ?? "";
    if (path.includes(" => ")) {
      // numstat rename format: "old => new" or "{old => new}/rest"
      path = path.replace(/\{([^}]*) => ([^}]*)\}/, (_m, _a, b: string) => b).replace(/^(.*) => (.*)$/, "$2");
    }
    entries.push({
      additions: addRaw === "-" ? null : Number(addRaw),
      deletions: delRaw === "-" ? null : Number(delRaw),
      path,
    });
  }
  return entries;
}

/** Merges name-status and numstat results into FileChange[]. */
function mergeFileChanges(nameStatus: NameStatusEntry[], numstat: NumstatEntry[]): FileChange[] {
  const countsByPath = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const entry of numstat) {
    countsByPath.set(entry.path, { additions: entry.additions, deletions: entry.deletions });
  }
  return nameStatus.map((entry) => {
    const counts = countsByPath.get(entry.path);
    return {
      path: entry.path,
      status: entry.code,
      additions: counts?.additions ?? null,
      deletions: counts?.deletions ?? null,
    };
  });
}

/** Full unified diff text for the given diff args. */
async function diffText(repoRoot: string, args: string[]): Promise<string> {
  const result = await runGit(["diff", ...args], repoRoot);
  return result.stdout.trimEnd();
}

/** Working-tree diff (uncommitted changes) relative to HEAD, or relative to
 * the empty tree when the repository has no commits yet. */
export async function getWorkingTreeDiff(repoRoot: string, hasCommits: boolean): Promise<string> {
  return diffText(repoRoot, hasCommits ? ["HEAD"] : ["--cached"]);
}

/** Numstat for the working tree, relative to HEAD (or empty tree). */
export async function getDiffNumstat(repoRoot: string, hasCommits: boolean): Promise<NumstatEntry[]> {
  return diffNumstat(repoRoot, hasCommits ? ["HEAD"] : ["--cached"]);
}

/** Diff text for a commit range (or from the empty tree, when the
 * repository had no commits before the session). */
export async function getCommitRangeDiff(
  repoRoot: string,
  startCommit: string | null,
  endCommit: string,
): Promise<string> {
  const start = startCommit ?? EMPTY_TREE_SHA;
  return diffText(repoRoot, [start, endCommit]);
}

/** `git log --oneline` for commits created during the session. */
export async function getCommitRangeLog(
  repoRoot: string,
  startCommit: string | null,
  endCommit: string,
): Promise<string> {
  const range = startCommit ? `${startCommit}..${endCommit}` : endCommit;
  const result = await runGit(["log", "--oneline", range], repoRoot);
  return result.stdout.trimEnd();
}

/** Best-effort diff for an untracked file, computed with `--no-index` so
 * the index is never touched. Returns null counts when the file is binary
 * or the diff cannot be computed. `git diff HEAD` never shows untracked
 * files' contents, so this is the only way to capture them. */
async function getUntrackedFileDiff(
  repoRoot: string,
  relPath: string,
): Promise<{ additions: number | null; deletions: number | null; text: string }> {
  const [numstatResult, textResult] = await Promise.all([
    runGit(["diff", "--no-index", "--numstat", "--", "/dev/null", relPath], repoRoot),
    runGit(["diff", "--no-index", "--", "/dev/null", relPath], repoRoot),
  ]);
  // --no-index exits 1 when there is a difference; that is expected, not an error.
  const line = numstatResult.stdout.split("\n")[0] ?? "";
  const cols = line.split("\t");
  const addRaw = cols[0] ?? "-";
  const delRaw = cols[1] ?? "-";
  const counts =
    addRaw === "-" || delRaw === "-" || addRaw === ""
      ? { additions: null, deletions: null }
      : { additions: Number(addRaw), deletions: Number(delRaw) };
  return { ...counts, text: textResult.stdout.trimEnd() };
}

/**
 * Computes the best-effort set of changes attributable to a session, given
 * Git snapshots captured before and after the agent ran.
 *
 * Handles the documented cases:
 *  A. uncommitted modifications only
 *  B. one or more commits created during the run
 *  C. commits + remaining uncommitted modifications
 *  D. repository had no commits at all
 *
 * Attribution of working-tree changes is best-effort: a path is considered
 * part of this session if its porcelain status code differs between the
 * before/after snapshots (including "did not appear before"). Pre-existing
 * uncommitted changes that are untouched by the session are excluded. This
 * is intentionally simple — AgentTrace does not attempt line-level or
 * patch-identity attribution.
 */
export async function getSessionChanges(
  repoRoot: string,
  before: GitSnapshot,
  after: GitSnapshot,
): Promise<SessionChanges> {
  const commitsHappened = before.commit !== after.commit;
  const diffParts: string[] = [];
  let files: FileChange[] = [];

  if (commitsHappened && after.commit) {
    const [nameStatus, numstat, text] = await Promise.all([
      diffNameStatus(repoRoot, [before.commit ?? EMPTY_TREE_SHA, after.commit]),
      diffNumstat(repoRoot, [before.commit ?? EMPTY_TREE_SHA, after.commit]),
      diffText(repoRoot, [before.commit ?? EMPTY_TREE_SHA, after.commit]),
    ]);
    files = files.concat(mergeFileChanges(nameStatus, numstat));
    if (text.length > 0) diffParts.push(text);
  }

  // Remaining / uncommitted changes, attributed via before/after status diff.
  const beforeMap = parsePorcelainMap(before.status);
  const afterMap = parsePorcelainMap(after.status);
  const attributedPaths = new Set<string>();
  for (const [path, code] of afterMap) {
    if (beforeMap.get(path) !== code) attributedPaths.add(path);
  }

  if (attributedPaths.size > 0) {
    const hasCommits = after.commit !== null;
    const [nameStatus, numstat, text] = await Promise.all([
      diffNameStatus(repoRoot, hasCommits ? ["HEAD"] : ["--cached"]),
      diffNumstat(repoRoot, hasCommits ? ["HEAD"] : ["--cached"]),
      diffText(repoRoot, hasCommits ? ["HEAD"] : ["--cached"]),
    ]);
    const workingChanges = mergeFileChanges(nameStatus, numstat).filter((f) =>
      attributedPaths.has(f.path),
    );
    if (workingChanges.length > 0) {
      files = files.concat(workingChanges);
      if (text.length > 0) diffParts.push(text);
    }

    // Untracked files never show up in `git diff`; handle them separately.
    const trackedPaths = new Set(workingChanges.map((f) => f.path));
    for (const [path, code] of afterMap) {
      if (code !== "??" || !attributedPaths.has(path) || trackedPaths.has(path)) continue;
      const untracked = await getUntrackedFileDiff(repoRoot, path);
      files.push({ path, status: "A", additions: untracked.additions, deletions: untracked.deletions });
      if (untracked.text.length > 0) diffParts.push(untracked.text);
    }
  }

  const additions = files.reduce((sum, f) => sum + (f.additions ?? 0), 0);
  const deletions = files.reduce((sum, f) => sum + (f.deletions ?? 0), 0);

  return {
    files,
    additions,
    deletions,
    diffText: diffParts.join("\n"),
  };
}
