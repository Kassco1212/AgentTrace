import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeDatabase, CURRENT_SCHEMA_VERSION } from "../src/db/schema";
import {
  addFileChanges,
  createSession,
  finishSession,
  getFileChanges,
  getSession,
  listSessions,
  markStaleRunningSessionsInterrupted,
} from "../src/db/sessions";

let db: Database;

beforeEach(() => {
  // In-memory database per test — fast and fully isolated.
  db = new Database(":memory:");
  initializeDatabase(db);
});

afterEach(() => {
  db.close();
});

describe("initializeDatabase", () => {
  test("creates schema_version row on a fresh database", () => {
    const row = db.query("SELECT version FROM schema_version").get() as { version: number };
    expect(row.version).toBe(CURRENT_SCHEMA_VERSION);
  });

  test("is idempotent — re-running does not duplicate schema_version rows", () => {
    initializeDatabase(db);
    initializeDatabase(db);
    const rows = db.query("SELECT version FROM schema_version").all();
    expect(rows.length).toBe(1);
  });

  test("throws on an unsupported future schema version", () => {
    db.query("UPDATE schema_version SET version = ?").run(CURRENT_SCHEMA_VERSION + 1);
    expect(() => initializeDatabase(db)).toThrow();
  });
});

describe("session lifecycle", () => {
  test("createSession inserts a running session and returns its id", () => {
    const id = createSession(db, {
      agent: "claude",
      prompt: "Add tests",
      repositoryPath: "/repo",
      branch: "main",
      startCommit: "aaa111",
      startStatus: "",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(id).toBeGreaterThan(0);

    const session = getSession(db, id);
    expect(session).not.toBeNull();
    expect(session?.status).toBe("running");
    expect(session?.agent).toBe("claude");
    expect(session?.endedAt).toBeNull();
  });

  test("finishSession updates status, timing, and diff stats", () => {
    const id = createSession(db, {
      agent: "codex",
      prompt: "Refactor",
      repositoryPath: "/repo",
      branch: "main",
      startCommit: "aaa111",
      startStatus: "",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    finishSession(db, {
      id,
      endCommit: "bbb222",
      endStatus: "",
      stdout: "output",
      stderr: "",
      diffText: "diff --git a/x b/x",
      additions: 10,
      deletions: 2,
      filesChanged: 1,
      exitCode: 0,
      status: "completed",
      endedAt: "2026-01-01T00:05:00.000Z",
      durationMs: 300000,
    });

    const session = getSession(db, id);
    expect(session?.status).toBe("completed");
    expect(session?.additions).toBe(10);
    expect(session?.deletions).toBe(2);
    expect(session?.filesChanged).toBe(1);
    expect(session?.endCommit).toBe("bbb222");
    expect(session?.durationMs).toBe(300000);
  });

  test("getSession returns null for a missing id", () => {
    expect(getSession(db, 999)).toBeNull();
  });
});

describe("file changes", () => {
  test("addFileChanges stores rows retrievable by session id", () => {
    const id = createSession(db, {
      agent: "claude",
      prompt: "Add auth",
      repositoryPath: "/repo",
      branch: "main",
      startCommit: null,
      startStatus: "",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    addFileChanges(db, id, [
      { sessionId: id, path: "src/auth.ts", status: "M", additions: 10, deletions: 2 },
      { sessionId: id, path: "src/jwt.ts", status: "A", additions: 40, deletions: 0 },
      { sessionId: id, path: "logo.png", status: "A", additions: null, deletions: null },
    ]);

    const changes = getFileChanges(db, id);
    expect(changes.length).toBe(3);
    expect(changes.map((c) => c.path)).toEqual(["src/auth.ts", "src/jwt.ts", "logo.png"]);
    expect(changes[2]?.additions).toBeNull();
  });

  test("addFileChanges is a no-op for an empty list", () => {
    const id = createSession(db, {
      agent: "claude",
      prompt: "noop",
      repositoryPath: "/repo",
      branch: "main",
      startCommit: null,
      startStatus: "",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    addFileChanges(db, id, []);
    expect(getFileChanges(db, id).length).toBe(0);
  });
});

describe("listSessions", () => {
  test("returns sessions newest first, respecting limit", () => {
    for (let i = 0; i < 5; i++) {
      createSession(db, {
        agent: "claude",
        prompt: `session ${i}`,
        repositoryPath: "/repo",
        branch: "main",
        startCommit: null,
        startStatus: "",
        startedAt: new Date(2026, 0, 1, 0, i).toISOString(),
      });
    }
    const results = listSessions(db, { limit: 3 });
    expect(results.length).toBe(3);
    expect(results[0]?.prompt).toBe("session 4");
    expect(results[2]?.prompt).toBe("session 2");
  });

  test("filters by agent", () => {
    createSession(db, {
      agent: "claude",
      prompt: "a",
      repositoryPath: "/repo",
      branch: "main",
      startCommit: null,
      startStatus: "",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    createSession(db, {
      agent: "codex",
      prompt: "b",
      repositoryPath: "/repo",
      branch: "main",
      startCommit: null,
      startStatus: "",
      startedAt: "2026-01-01T00:01:00.000Z",
    });
    const results = listSessions(db, { limit: 20, agent: "codex" });
    expect(results.length).toBe(1);
    expect(results[0]?.agent).toBe("codex");
  });
});

describe("markStaleRunningSessionsInterrupted", () => {
  test("marks only running sessions older than the threshold", () => {
    const oldId = createSession(db, {
      agent: "claude",
      prompt: "old",
      repositoryPath: "/repo",
      branch: "main",
      startCommit: null,
      startStatus: "",
      startedAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
    });
    const recentId = createSession(db, {
      agent: "claude",
      prompt: "recent",
      repositoryPath: "/repo",
      branch: "main",
      startCommit: null,
      startStatus: "",
      startedAt: new Date().toISOString(),
    });

    const changed = markStaleRunningSessionsInterrupted(db, 6 * 60 * 60 * 1000);
    expect(changed).toBe(1);
    expect(getSession(db, oldId)?.status).toBe("interrupted");
    expect(getSession(db, recentId)?.status).toBe("running");
  });
});
