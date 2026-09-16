# AgentTrace

Local Git-aware traces for coding agents.

AgentTrace records coding-agent sessions and connects prompts, terminal
output and Git changes in a local SQLite database.

```
agenttrace init
agenttrace run claude \
  --prompt "Add JWT authentication"
agenttrace list
agenttrace show 1
```

## What is AgentTrace?

AgentTrace is a lightweight, terminal-only wrapper around coding-agent CLIs
(currently [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and
the [Codex CLI](https://developers.openai.com/)). It runs the agent for you,
streams its output live, and records what happened — the prompt, the
transcript, and the Git changes the agent made — in a local SQLite database.

It is not an AI agent itself, not an IDE, and not an orchestration platform.
It is a **local Git-aware flight recorder for coding-agent sessions**.

## Why?

Git already tells you *what* changed. AgentTrace also records:

- which coding agent made the changes
- what that agent was asked to do
- what happened during the run (the full transcript)
- which files changed and how much (`+214 -37`)
- which commits appeared during the run
- what repository state existed before and after

AgentTrace adds execution context around Git history for AI coding agents.

## Features

- Wraps `claude` and `codex`, with an adapter architecture that makes adding
  more agents straightforward
- Streams agent output to your terminal live — never buffers silently
- Captures Git state before and after each run, and reconciles commits made
  *during* the run with any changes left uncommitted afterward
- Everything is stored locally in SQLite (`.agenttrace/agenttrace.db`) —
  nothing is uploaded anywhere
- Best-effort secret redaction before anything is persisted
- Handles Ctrl+C cleanly: the agent is interrupted, and the session is still
  saved (not lost) with status `interrupted`

## Installation

Requires [Bun](https://bun.sh) and Git.

```
git clone <this-repo>
cd agenttrace
bun install
bun link
```

`bun link` makes `agenttrace` available on your PATH. Alternatively, run it
directly during development:

```
bun run src/cli.ts --help
```

## Quick start

```
cd my-project
agenttrace init
agenttrace run claude --prompt "Add JWT authentication"
agenttrace list
agenttrace show 1
```

## Commands

```
agenttrace init              Initialize AgentTrace in the current Git repository
agenttrace run <agent>       Run and record a coding agent
agenttrace list               List recorded agent sessions
agenttrace show <id>         Show a recorded session
agenttrace --help
agenttrace --version
```

**`agenttrace init`** — verifies you're inside a Git repository, creates
`.agenttrace/agenttrace.db`, and adds `.agenttrace/` to `.gitignore` (without
disturbing anything else already there). Safe to run more than once.

**`agenttrace run <agent> --prompt "<prompt>"`** — runs the given coding
agent (`claude` or `codex`) with the given prompt, streaming its output to
your terminal while recording the session. Supported agents:

```
claude
codex
```

**`agenttrace list [--limit N] [--agent <name>]`** — lists recent sessions,
newest first. Default limit is 20.

**`agenttrace show <id> [--diff] [--no-transcript]`** — shows full detail for
one session. `--diff` includes the full recorded diff (omitted by default to
keep the output short). `--no-transcript` omits the captured stdout/stderr.

## Example output

```
$ agenttrace run claude --prompt "Add request validation"
AgentTrace
Recording session...
Agent:       claude
Branch:      feature/auth
Base commit: a83bc21
────────────────────────────────────
[Claude output streams here...]
────────────────────────────────────
✓ AgentTrace session saved
  Session     #8
  Agent       claude
  Status      completed
  Duration    02m 14s
  Files       4 changed
  Diff        +126 -18
  Before      a83bc21
  After       32d81af
Saved to .agenttrace/agenttrace.db

$ agenttrace list
ID   AGENT    STARTED        DURATION  FILES  DIFF        COMMIT    STATUS
8    claude   Sep 16 21:14   02:14     4      +126 -18    32d81af   completed
7    codex    Sep 16 20:31   04:02     8      +311 -74    -         completed
```

## How it works

Each `agenttrace run` follows this flow:

```
validate environment (Git repo, initialized, agent installed)
        ↓
capture Git state before (branch, HEAD commit, status)
        ↓
create a "running" session row in SQLite
        ↓
spawn the coding agent, streaming stdout/stderr live while capturing it
        ↓
capture Git state after
        ↓
reconcile: commits made during the run + any remaining uncommitted changes
        ↓
finalize the session row (completed / failed / interrupted) and save file changes
```

Git commands are run directly via `git` (never a JS Git library), and the
agent process is always spawned as an argument array
(`Bun.spawn([executable, ...args])`) — never a shell string — so prompts and
paths can never be interpreted as shell syntax.

### Attributing changes to a session

A session's Git state is captured both before and after the agent runs.
AgentTrace compares `git status --porcelain` snapshots from both points to
decide which working-tree changes are new since the session started, so a
file that was already modified before the session began (and untouched by
the agent) isn't misattributed to it. If the agent creates commits during
the run, those are captured too, by diffing the before/after commit range —
so a run where the agent commits its own changes doesn't show up as "0 files
changed" just because `git diff` (working tree only) came back empty.

This attribution is **best-effort**. AgentTrace does not attempt line-level
or patch-identity attribution — see Limitations below.

## Local storage

Everything AgentTrace records lives in:

```
<repository-root>/.agenttrace/agenttrace.db
```

This is a plain SQLite database with two tables: `sessions` and
`file_changes` (plus a `schema_version` table). No ORM — direct SQL with
prepared statements. `.agenttrace/` is added to `.gitignore` automatically.

## Privacy and security

AgentTrace is local-first. It never uploads transcripts, prompts, source
code, or diffs anywhere, never sends telemetry, and requires no account or
login. The external coding agent you run (Claude Code, Codex) may itself use
network services according to its own configuration — that's outside
AgentTrace's control.

The database can contain prompts, agent output, source-code diffs,
filenames, and repository paths — potentially sensitive information.
AgentTrace applies a **best-effort** secret scrubber (patterns like
`API_KEY=...`, `PASSWORD=...`, `Authorization: Bearer ...`) before writing
prompts, transcripts, and diffs to SQLite.

**Secret redaction is best-effort and must not be treated as a complete
secrets scanner or a security boundary.** Review `.agenttrace/agenttrace.db`
before sharing it, and don't commit it (it's gitignored by default for this
reason).

AgentTrace's own Git usage is read-only. It never runs `git commit`,
`git push`, `git reset`, `git checkout`, `git restore`, `git clean`,
`git rebase`, or `git merge`. The one exception is `agenttrace init`, which
may append a line to `.gitignore`.

## Supported coding agents

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
- [Codex CLI](https://developers.openai.com/) (`codex`)

Agent invocation details are isolated behind small adapters
(`src/agents/claude.ts`, `src/agents/codex.ts`) since these CLIs' flags can
change over time. If Claude Code or Codex's non-interactive invocation
changes, only the relevant adapter needs updating.

## Limitations

This is an intentionally small MVP. Known limitations:

- **Attribution is best-effort.** Working-tree change attribution is based
  on comparing `git status --porcelain` snapshots before/after, not
  line-level or patch-identity tracking. In rare cases (e.g. the agent
  reverts a pre-existing change back to a state that matches a *different*
  pre-existing status code) attribution could be imperfect.
- **No stale-session daemon.** A `running` session is finalized on success,
  failure, or Ctrl+C. If AgentTrace itself is killed in a way it can't
  handle (e.g. `SIGKILL`, power loss), that session can be left marked
  `running`. `agenttrace list` opportunistically marks sessions `running`
  for longer than 6 hours as `interrupted`; there is no background daemon,
  heartbeat, or lock server.
- **Renames aren't always preserved as renames.** If an agent renames a file
  it just created (or otherwise produces a diff Git's similarity detection
  doesn't recognize as a rename), it may show up as an add/delete pair
  instead of a single `R` entry.
- **No line-level secret detection.** See Privacy and security above.

## Roadmap

Not implemented in 0.1.0, but plausible future directions:

- Additional coding-agent adapters (e.g. OpenCode)
- Session search
- JSON output for scripting
- Richer commit/session reconciliation
- Optional interactive TUI
- Git hooks
- Session export

## Inspiration

AgentTrace is an independent open-source project inspired by the idea of
connecting coding-agent sessions with source-control checkpoints, as
explored by [Atlas](https://github.com/pacifio/atlas). AgentTrace does not
reuse Atlas source code and is not affiliated with, endorsed by, or a fork
or port of Atlas.

## License

MIT — see [LICENSE](./LICENSE).
