// Timestamp/duration formatting. Timestamps are stored as ISO 8601 UTC
// strings in SQLite and formatted for display in the user's local timezone
// only at the CLI-rendering boundary.

export function nowIso(): string {
  return new Date().toISOString();
}

/** Formats a duration in milliseconds as `MMm SSs` (e.g. "03m 42s"), or
 * `HHh MMm SSs` beyond an hour. */
export function formatDuration(durationMs: number | null): string {
  if (durationMs === null || Number.isNaN(durationMs)) return "-";
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    const hh = String(hours).padStart(2, "0");
    return `${hh}h ${mm}m ${ss}s`;
  }
  return `${mm}m ${ss}s`;
}

/** Short `MM:SS` form used in table columns. */
export function formatDurationShort(durationMs: number | null): string {
  if (durationMs === null || Number.isNaN(durationMs)) return "-";
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Formats an ISO timestamp for display in the local timezone, e.g.
 * "2026-09-16 21:32:11" or, with `short`, "Sep 16 21:32". */
export function formatTimestamp(iso: string, short = false): string {
  const date = new Date(iso);
  if (short) {
    const month = date.toLocaleString(undefined, { month: "short" });
    const day = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${month} ${day} ${hh}:${mm}`;
  }
  const yyyy = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mo}-${dd} ${hh}:${mi}:${ss}`;
}
