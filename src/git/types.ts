// Types for the Git inspection layer. AgentTrace only ever reads Git state;
// it never mutates the repository (see src/git/git.ts for the read-only
// command list).

export interface GitSnapshot {
  repositoryRoot: string;
  commit: string | null;
  branch: string | null;
  status: string;
}

export interface FileChange {
  path: string;
  status: string;
  additions: number | null;
  deletions: number | null;
}

export interface SessionChanges {
  files: FileChange[];
  additions: number;
  deletions: number;
  diffText: string;
}
