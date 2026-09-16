// Runs an external coding-agent process, streaming its stdout/stderr to the
// user's terminal in real time while simultaneously capturing it, and
// forwarding SIGINT so Ctrl+C stops the child cleanly.
//
// Always spawned as an argument array (Bun.spawn([executable, ...args])),
// never as a shell string — see "Process safety" in the spec.

export interface AgentRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  interrupted: boolean;
}

async function pumpStream(
  stream: ReadableStream<Uint8Array> | null,
  sink: { write(chunk: Uint8Array): number | Promise<number>; flush(): number | Promise<number> },
  chunks: Uint8Array[],
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length > 0) {
      chunks.push(value);
      sink.write(value);
      await sink.flush();
    }
  }
}

function concatChunks(chunks: Uint8Array[]): string {
  if (chunks.length === 0) return "";
  let totalLength = 0;
  for (const chunk of chunks) totalLength += chunk.length;
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(combined);
}

/**
 * Spawns `executable args…` in `cwd`, streaming both stdout and stderr to
 * the current process's terminal while capturing full transcripts. If the
 * user presses Ctrl+C, SIGINT is forwarded to the child and the returned
 * result has `interrupted: true`.
 */
export async function runAgentProcess(
  executable: string,
  args: string[],
  cwd: string,
): Promise<AgentRunResult> {
  const proc = Bun.spawn([executable, ...args], {
    cwd,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });

  let interrupted = false;
  const sigintHandler = () => {
    interrupted = true;
    try {
      proc.kill("SIGINT");
    } catch {
      // Process may have already exited; nothing more to do.
    }
  };
  process.on("SIGINT", sigintHandler);

  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  const stdoutWriter = Bun.stdout.writer();
  const stderrWriter = Bun.stderr.writer();

  try {
    await Promise.all([
      pumpStream(proc.stdout, stdoutWriter, stdoutChunks),
      pumpStream(proc.stderr, stderrWriter, stderrChunks),
    ]);
    const exitCode = await proc.exited;
    return {
      stdout: concatChunks(stdoutChunks),
      stderr: concatChunks(stderrChunks),
      exitCode,
      interrupted,
    };
  } finally {
    process.off("SIGINT", sigintHandler);
  }
}
