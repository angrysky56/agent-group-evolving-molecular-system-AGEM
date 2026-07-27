/**
 * check-log-reader.ts — on-demand drill-down into a run's satisfiability log.
 *
 * `evaluate_logical_consistency` returns a digest plus the entries that carry
 * signal (see summarizeCheckLog). The complete log is written to the run's
 * JSONL. This reads it back, filtered, so "which checks ran, and what exactly
 * did the prover say?" stays answerable without putting a megabyte of routine
 * `consistent` verdicts into the model's context up front.
 *
 * Reading is streamed line-by-line: a single JSONL line legitimately holds a
 * whole check log and can be megabytes, and the surrounding file grows with
 * every event in the run.
 */

import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { settings } from "../config.js";
import type { CheckLogEntry } from "./logicalCohomology.js";

export interface CheckLogQuery {
  runLogId: string;
  /** Restrict to one check kind. */
  kind?: CheckLogEntry["kind"];
  /** Restrict to one prover verdict. */
  verdict?: CheckLogEntry["verdict"];
  /** Keep only entries covering ALL of these block names (case-insensitive). */
  blocks?: string[];
  limit?: number;
  offset?: number;
}

export interface CheckLogPage {
  runLogId: string;
  totalChecks: number;
  matched: number;
  returned: number;
  offset: number;
  entries: CheckLogEntry[];
  note?: string;
  error?: string;
}

/** Entries per page. The drill-down must not recreate the problem it solves. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

/**
 * Run ids are generated as an ISO timestamp with `:`/`.` replaced by `-`, plus
 * a base-36 suffix. Anything outside that alphabet is rejected rather than
 * sanitised: this value reaches a path join, and a model-supplied string that
 * needs cleaning to be safe is a string worth refusing.
 */
const RUN_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

function isCheckLogEntry(value: unknown): value is CheckLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.kind === "string" &&
    typeof entry.verdict === "string" &&
    Array.isArray(entry.blocks) &&
    Array.isArray(entry.formulas)
  );
}

/** Pull every check-log entry out of one JSONL event, whichever shape it has. */
function entriesFromEvent(event: Record<string, unknown>): CheckLogEntry[] {
  // Current shape: a dedicated event carrying the complete log.
  if (event.type === "logic_check_log" && Array.isArray(event.checkLog)) {
    return event.checkLog.filter(isCheckLogEntry);
  }
  // Runs logged before the split still have the log inline in the tool result.
  if (
    event.type === "tool_result" &&
    event.name === "evaluate_logical_consistency" &&
    typeof event.output === "string"
  ) {
    try {
      const parsed = JSON.parse(event.output) as Record<string, unknown>;
      if (Array.isArray(parsed.checkLog)) {
        return parsed.checkLog.filter(isCheckLogEntry);
      }
    } catch {
      // A malformed line is skipped, never fatal — the rest of the log is
      // still worth returning.
    }
  }
  return [];
}

function matches(entry: CheckLogEntry, query: CheckLogQuery): boolean {
  if (query.kind && entry.kind !== query.kind) return false;
  if (query.verdict && entry.verdict !== query.verdict) return false;
  if (query.blocks && query.blocks.length > 0) {
    const present = new Set(entry.blocks.map((b) => b.toLowerCase()));
    if (!query.blocks.every((b) => present.has(b.trim().toLowerCase()))) {
      return false;
    }
  }
  return true;
}

/**
 * Read one run's check log, filtered and paged.
 *
 * Never throws: a missing or unreadable run log is reported in `error` so the
 * agent can say so plainly rather than treating absence as evidence.
 */
export async function readCheckLog(
  query: CheckLogQuery,
  /** Where run logs live. Defaults to the configured knowledge base; taking it
   * as an argument keeps the reader testable without mutating global config. */
  runsDir: string = join(settings.all.KNOWLEDGE_BASE_PATH, "runs"),
): Promise<CheckLogPage> {
  const runLogId = query.runLogId.trim();
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(query.limit ?? DEFAULT_LIMIT)),
  );
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const empty: CheckLogPage = {
    runLogId,
    totalChecks: 0,
    matched: 0,
    returned: 0,
    offset,
    entries: [],
  };

  if (!runLogId || !RUN_ID_PATTERN.test(runLogId)) {
    return {
      ...empty,
      error:
        "Invalid runLogId. Use the `runLogId` returned by " +
        "evaluate_logical_consistency verbatim.",
    };
  }

  const jsonlPath = join(runsDir, `${runLogId}.jsonl`);
  if (!existsSync(jsonlPath)) {
    return {
      ...empty,
      error:
        `No run log found for "${runLogId}". Run logs live in ` +
        "knowledge_base/runs/ and are written as the run proceeds.",
    };
  }

  let total = 0;
  let matched = 0;
  const entries: CheckLogEntry[] = [];
  try {
    const reader = createInterface({
      input: createReadStream(jsonlPath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of reader) {
      if (!line.trim()) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      for (const entry of entriesFromEvent(event)) {
        total += 1;
        if (!matches(entry, query)) continue;
        matched += 1;
        if (matched > offset && entries.length < limit) entries.push(entry);
      }
    }
    reader.close();
  } catch (error) {
    return {
      ...empty,
      error: `Could not read run log: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const remaining = Math.max(0, matched - offset - entries.length);
  return {
    runLogId,
    totalChecks: total,
    matched,
    returned: entries.length,
    offset,
    entries,
    note:
      total === 0
        ? "This run log contains no satisfiability checks."
        : remaining > 0
          ? `${remaining} more matching entr${remaining === 1 ? "y" : "ies"}; ` +
            `re-call with offset ${offset + entries.length}.`
          : undefined,
  };
}
