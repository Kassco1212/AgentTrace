// Shared types used across AgentTrace modules.

/** Lifecycle status of a recorded agent session. */
export type SessionStatus = "running" | "completed" | "failed" | "interrupted";

/** A single row from the `sessions` table. */
export interface SessionRecord {
  id: number;
  agent: string;
  prompt: string;
  repositoryPath: string;
  branch: string | null;
  startCommit: string | null;
  endCommit: string | null;
  startStatus: string | null;
  endStatus: string | null;
  stdout: string | null;
  stderr: string | null;
  diffText: string | null;
  additions: number;
  deletions: number;
  filesChanged: number;
  exitCode: number | null;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

/** A single changed file associated with a session. */
export interface FileChangeRecord {
  id?: number;
  sessionId: number;
  path: string;
  status: string;
  additions: number | null;
  deletions: number | null;
}

/** Fields required to open a new session row before the agent runs. */
export interface NewSessionInput {
  agent: string;
  prompt: string;
  repositoryPath: string;
  branch: string | null;
  startCommit: string | null;
  startStatus: string | null;
  startedAt: string;
}

/** Fields used to finalize a session row after the agent finishes. */
export interface FinishSessionInput {
  id: number;
  endCommit: string | null;
  endStatus: string | null;
  stdout: string;
  stderr: string;
  diffText: string;
  additions: number;
  deletions: number;
  filesChanged: number;
  exitCode: number | null;
  status: SessionStatus;
  endedAt: string;
  durationMs: number;
}
