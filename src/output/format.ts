// CLI rendering. Kept separate from SQL/Git logic so presentation changes
// never touch the data layers. Colors are ANSI escape codes applied only
// when useful, and never relied upon to convey information (respects
// NO_COLOR).

import type { FileChangeRecord, SessionRecord } from "../types";
import { formatDuration, formatDurationShort, formatTimestamp } from "../utils/time";

const colorEnabled = !process.env["NO_COLOR"] && process.stdout.isTTY;

function color(code: string, text: string): string {
  return colorEnabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const green = (text: string): string => color("32", text);
export const red = (text: string): string => color("31", text);
export const dim = (text: string): string => color("2", text);
export const bold = (text: string): string => color("1", text);
export const cyan = (text: string): string => color("36", text);

/** "+214 -37" style summary, or "-" when nothing changed. */
export function formatDiffStat(additions: number, deletions: number, filesChanged: number): string {
  if (filesChanged === 0) return "-";
  return `+${additions} -${deletions}`;
}

export function shortCommit(commit: string | null): string {
  if (!commit) return "-";
  return commit.slice(0, 7);
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** Renders the `agenttrace list` table. */
export function formatSessionTable(sessions: SessionRecord[]): string {
  const headers = ["ID", "AGENT", "STARTED", "DURATION", "FILES", "DIFF", "COMMIT", "STATUS"];
  const widths = [4, 8, 14, 9, 6, 11, 9, 11];

  const lines: string[] = [];
  lines.push(headers.map((h, i) => pad(h, widths[i] ?? 0)).join(" "));

  for (const s of sessions) {
    const cells = [
      String(s.id),
      s.agent,
      formatTimestamp(s.startedAt, true),
      formatDurationShort(s.durationMs),
      String(s.filesChanged),
      formatDiffStat(s.additions, s.deletions, s.filesChanged),
      shortCommit(s.endCommit ?? s.startCommit),
      s.status,
    ];
    const rendered = cells.map((c, i) => pad(c, widths[i] ?? 0)).join(" ");
    lines.push(s.status === "failed" ? red(rendered) : rendered);
  }
  return lines.join("\n");
}

/** Renders the completion summary printed after `agenttrace run` finishes. */
export function formatRunSummary(session: SessionRecord): string {
  const ok = session.status === "completed";
  const icon = ok ? green("\u2713") : red("\u2717");
  let heading: string;
  if (ok) {
    heading = `${icon} AgentTrace session saved`;
  } else if (session.status === "interrupted") {
    heading = `${icon} Session interrupted`;
  } else {
    heading = `${icon} Agent exited with code ${session.exitCode ?? "?"}`;
  }

  const lines = [heading];
  lines.push(`  Session     #${session.id}`);
  lines.push(`  Agent       ${session.agent}`);
  lines.push(`  Status      ${session.status}`);
  lines.push(`  Duration    ${formatDuration(session.durationMs)}`);
  lines.push(`  Files       ${session.filesChanged} changed`);
  if (session.filesChanged > 0) {
    lines.push(`  Diff        ${formatDiffStat(session.additions, session.deletions, session.filesChanged)}`);
  }
  if (session.startCommit || session.endCommit) {
    lines.push(`  Before      ${shortCommit(session.startCommit)}`);
    lines.push(`  After       ${shortCommit(session.endCommit)}`);
  }
  return lines.join("\n");
}

interface ShowOptions {
  includeDiff: boolean;
  includeTranscript: boolean;
}

/** Renders the `agenttrace show <id>` detail view. */
export function formatSessionDetail(
  session: SessionRecord,
  fileChanges: FileChangeRecord[],
  options: ShowOptions,
): string {
  const lines: string[] = [];
  lines.push(bold(`Session #${session.id}`));
  lines.push(`Status:      ${session.status}`);
  lines.push(`Agent:       ${session.agent}`);
  lines.push(`Started:     ${formatTimestamp(session.startedAt)}`);
  lines.push(`Finished:    ${session.endedAt ? formatTimestamp(session.endedAt) : "-"}`);
  lines.push(`Duration:    ${formatDuration(session.durationMs)}`);
  lines.push(`Exit code:   ${session.exitCode ?? "-"}`);
  lines.push("");
  lines.push("Repository:");
  lines.push(`  Branch:    ${session.branch ?? "detached HEAD"}`);
  lines.push(`  Before:    ${session.startCommit ?? "(no commits)"}`);
  lines.push(`  After:     ${session.endCommit ?? "(no commits)"}`);
  if (session.startCommit && session.endCommit && session.startCommit !== session.endCommit) {
    lines.push(`  Commits:   ${shortCommit(session.startCommit)} \u2192 ${shortCommit(session.endCommit)}`);
  }
  lines.push("");
  lines.push("Prompt:");
  lines.push(`  ${session.prompt}`);

  if (fileChanges.length > 0) {
    lines.push("");
    lines.push("Files:");
    for (const f of fileChanges) {
      const stats =
        f.additions === null && f.deletions === null ? "(binary)" : `+${f.additions ?? 0} -${f.deletions ?? 0}`;
      lines.push(`  ${pad(f.status, 2)} ${pad(f.path, 28)} ${stats}`);
    }
    lines.push("");
    lines.push("Total:");
    lines.push(`  ${session.filesChanged} files`);
    lines.push(`  +${session.additions} -${session.deletions}`);
  } else {
    lines.push("");
    lines.push("Files:");
    lines.push("  (no changes detected)");
  }

  if (options.includeTranscript) {
    lines.push("");
    lines.push("Transcript:");
    const transcript = session.stdout && session.stdout.length > 0 ? session.stdout : "(empty)";
    lines.push(indent(transcript));
    if (session.stderr && session.stderr.length > 0) {
      lines.push("");
      lines.push("Stderr:");
      lines.push(indent(session.stderr));
    }
  }

  if (options.includeDiff) {
    lines.push("");
    lines.push("Diff:");
    lines.push(indent(session.diffText && session.diffText.length > 0 ? session.diffText : "(no diff recorded)"));
  }

  return lines.join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
