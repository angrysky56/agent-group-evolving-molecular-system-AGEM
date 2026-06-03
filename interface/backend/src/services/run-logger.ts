/**
 * run-logger.ts — persistent, structured trace of each chat run.
 *
 * Motivation: the most important facts about a run — what text was fed into the
 * graph each cycle, and the full input/output of every tool call — were only
 * visible in the live terminal stream, never persisted. That made post-hoc
 * debugging depend on hand-copied snippets and lost most of what happened.
 *
 * This logger writes one JSONL file per run to <KNOWLEDGE_BASE_PATH>/runs/, plus
 * a human-readable .md transcript alongside it. Each line of the JSONL is one
 * event with a timestamp; nothing is truncated. The files are append-only during
 * a run and safe to read while it is in progress.
 *
 * Events captured:
 *   - run_start / run_end (model, turn count, elapsed)
 *   - turn (turn index, which model)
 *   - tool_call (name, FULL args — including the text fed to run_agem_cycle)
 *   - tool_result (name, FULL output)
 *   - cycle_ingest (the exact text ingested into the graph + token estimate)
 *   - note (free-form, e.g. parse-repair events)
 */

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { settings } from "../config.js";

export interface RunLogger {
  runId: string;
  jsonlPath: string;
  mdPath: string;
  event(type: string, data: Record<string, unknown>): void;
  toolCall(name: string, args: unknown): void;
  toolResult(name: string, output: string): void;
  cycleIngest(text: string): void;
  end(summary: Record<string, unknown>): void;
}

const NULL_LOGGER: RunLogger = {
  runId: "disabled",
  jsonlPath: "",
  mdPath: "",
  event() {},
  toolCall() {},
  toolResult() {},
  cycleIngest() {},
  end() {},
};

function ts(): string {
  return new Date().toISOString();
}

/** Rough token estimate (≈4 chars/token) — only for at-a-glance sizing. */
function estTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/**
 * Create a run logger. If anything about the filesystem setup fails, returns a
 * no-op logger rather than throwing — logging must never break a run.
 */
export function createRunLogger(meta: {
  model: string;
  sessionId?: string;
  message?: string;
}): RunLogger {
  try {
    const base = settings.all.KNOWLEDGE_BASE_PATH;
    const dir = join(base, "runs");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const stamp = ts().replace(/[:.]/g, "-");
    const runId = `${stamp}_${Math.random().toString(36).slice(2, 8)}`;
    const jsonlPath = join(dir, `${runId}.jsonl`);
    const mdPath = join(dir, `${runId}.md`);

    const writeJsonl = (type: string, data: Record<string, unknown>) => {
      try {
        appendFileSync(
          jsonlPath,
          JSON.stringify({ t: ts(), type, ...data }) + "\n",
        );
      } catch {
        /* never throw from logging */
      }
    };
    const writeMd = (text: string) => {
      try {
        appendFileSync(mdPath, text + "\n");
      } catch {
        /* never throw */
      }
    };

    // Seed the markdown transcript header.
    try {
      writeFileSync(
        mdPath,
        [
          `# AGEM run ${runId}`,
          "",
          `- **model**: ${meta.model}`,
          `- **session**: ${meta.sessionId ?? "—"}`,
          `- **started**: ${ts()}`,
          "",
          "## User message",
          "",
          "```",
          (meta.message ?? "").slice(0, 4000),
          "```",
          "",
          "## Trace",
          "",
        ].join("\n"),
      );
    } catch {
      /* ignore */
    }
    writeJsonl("run_start", {
      runId,
      model: meta.model,
      sessionId: meta.sessionId,
      messageChars: (meta.message ?? "").length,
    });

    return {
      runId,
      jsonlPath,
      mdPath,
      event(type, data) {
        writeJsonl(type, data);
      },
      toolCall(name, args) {
        const argStr = JSON.stringify(args ?? {});
        writeJsonl("tool_call", { name, args: args ?? {} });
        writeMd(
          `### → tool_call \`${name}\`\n\n\`\`\`json\n${argStr.slice(0, 8000)}\n\`\`\`\n`,
        );
      },
      toolResult(name, output) {
        writeJsonl("tool_result", { name, output });
        writeMd(
          `### ← tool_result \`${name}\` (${output.length} chars)\n\n\`\`\`\n${output.slice(0, 8000)}\n\`\`\`\n`,
        );
      },
      cycleIngest(text) {
        writeJsonl("cycle_ingest", {
          chars: text.length,
          estTokens: estTokens(text),
          text,
        });
        writeMd(
          `### ⊕ cycle_ingest (${text.length} chars, ~${estTokens(text)} tokens)\n\n> The text actually fed into the TNA graph this cycle:\n\n\`\`\`\n${text.slice(0, 8000)}\n\`\`\`\n`,
        );
      },
      end(summary) {
        writeJsonl("run_end", summary);
        writeMd(
          `\n## Run end\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`,
        );
      },
    };
  } catch {
    return NULL_LOGGER;
  }
}
