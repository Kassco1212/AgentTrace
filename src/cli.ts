#!/usr/bin/env bun
// AgentTrace CLI entrypoint. Wires Commander.js commands to the command
// implementations in src/commands/ — no business logic lives here.

import { Command } from "commander";
import { runInit } from "./commands/init";
import { runRun } from "./commands/run";
import { runList } from "./commands/list";
import { runShow } from "./commands/show";
import { SUPPORTED_AGENTS } from "./agents/registry";

const VERSION = "0.1.0";

const program = new Command();

program
  .name("agenttrace")
  .description("AgentTrace \u2014 local source-control traces for coding agents")
  .version(VERSION, "--version", "Show the AgentTrace version")
  .addHelpText(
    "after",
    `
Examples:
  agenttrace init
  agenttrace run claude --prompt "Fix authentication tests"
  agenttrace run codex --prompt "Refactor database layer"
  agenttrace list
  agenttrace show 12
  agenttrace show 12 --diff
`,
  );

program
  .command("init")
  .description("Initialize AgentTrace in the current Git repository")
  .action(async () => {
    await runInit();
  });

program
  .command("run")
  .description(`Run and record a coding agent (${SUPPORTED_AGENTS.join(", ")})`)
  .argument("<agent>", `coding agent to run (${SUPPORTED_AGENTS.join(", ")})`)
  .requiredOption("--prompt <text>", "prompt to give the coding agent")
  .action(async (agent: string, opts: { prompt: string }) => {
    await runRun({ agent, prompt: opts.prompt });
  });

program
  .command("list")
  .description("List recorded agent sessions")
  .option("--limit <n>", "maximum sessions to show", "20")
  .option("--agent <name>", "filter by agent")
  .action(async (opts: { limit: string; agent?: string }) => {
    const limit = Number.parseInt(opts.limit, 10);
    await runList({ limit: Number.isFinite(limit) && limit > 0 ? limit : 20, agent: opts.agent });
  });

program
  .command("show")
  .description("Show a recorded session")
  .argument("<id>", "session ID")
  .option("--diff", "include the full recorded diff", false)
  .option("--no-transcript", "omit the captured transcript")
  .action(async (id: string, opts: { diff: boolean; transcript: boolean }) => {
    const parsedId = Number.parseInt(id, 10);
    if (!Number.isInteger(parsedId) || String(parsedId) !== id.trim()) {
      console.error(`Invalid session ID: ${id}`);
      process.exitCode = 1;
      return;
    }
    await runShow({
      id: parsedId,
      diff: opts.diff,
      noTranscript: !opts.transcript,
    });
  });

program.parseAsync(process.argv);
