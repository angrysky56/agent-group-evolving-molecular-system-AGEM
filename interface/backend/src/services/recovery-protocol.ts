/**
 * recovery-protocol.ts — bounded, three-level failure recovery for tool calls.
 *
 * Problem this solves
 * -------------------
 * Before this module, every tool failure in the chat loop collapsed into a
 * string (`"Error executing tool: " + err.message`) that was handed straight to
 * the LLM, which then decided ad hoc whether to retry, give up, or try
 * something else — with no bound on attempts and no record of why. That is the
 * classic unbounded-recovery pathology: infinite retry on a permanently broken
 * call, or premature abandonment on a transient network blip. The only retry
 * rule in the system was prose in the system prompt ("retry ONCE"), which is
 * unenforceable by construction.
 *
 * Design (mirrors the escalation ladder in
 * "From Agent Loops to Structured Graphs", Hu Wei, arXiv:2604.11378, §4.4/§6.2)
 *
 *   Level 1  local_retry  — transient errors (network, timeout, rate limit,
 *                           5xx). Retried engine-side with backoff. Costs no
 *                           LLM turn. Budget: `retryBudget` (default 2).
 *   Level 2  local_patch  — schema / bad-argument errors. A deterministic
 *                           repair function rewrites the arguments, then one
 *                           re-run is attempted. Costs no LLM turn.
 *   Level 3  escalate     — surface to the LLM, but as a terse, structured
 *                           notice rather than a raw error blob.
 *
 * Escalation invariant (§6.2): level i must be exhausted before level i+1 may
 * be entered. This is enforced mechanically by a per-call recovery-state
 * counter, not by convention:
 *
 *   recoveryState ∈ { pristine → retried → patched }
 *
 * `attemptPatch` throws unless state ≥ retried; `escalate` throws unless
 * state ≥ patched. Errors classified `structural` (unknown tool, auth failure,
 * path traversal, malformed plan) are *unpatchable*: lower levels are marked
 * vacuously exhausted with an explicit reason, so the invariant still holds
 * literally and the audit trail shows why levels were skipped.
 *
 * Context partition (§5.4)
 * ------------------------
 * `RecoveryOutcome.output` is the ONLY thing that may enter the execution
 * context (chat history). It is terse, single-line, and length-capped. The
 * full error — stack, response body, patched arguments, every attempt — goes
 * to `onDiagnostic`, which the caller wires to the run log. Failure history
 * must not become implicit input to subsequent reasoning steps, and must never
 * reach the concept graph.
 *
 * This module performs no I/O and has no dependency on the chat route, so it
 * is directly unit-testable.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Coarse failure class. Determines which recovery level is even applicable. */
export type ErrorClass = "cancelled" | "transient" | "schema" | "structural";

/** Highest recovery level reached. 0 = succeeded on the first attempt. */
export type RecoveryLevel = 0 | 1 | 2 | 3;

/** Per-call escalation state. Ordered: pristine < retried < patched. */
export type RecoveryState = "pristine" | "retried" | "patched";

const STATE_RANK: Record<RecoveryState, number> = {
  pristine: 0,
  retried: 1,
  patched: 2,
};

/** Structured diagnosis `d = (φ, c, r, α)` — §6.3. */
export interface Diagnosis {
  /** φ — the observed failure, one line, no newlines. */
  phi: string;
  /** c — root-cause hypothesis. */
  cause: string;
  /** r — the recovery action this diagnosis recommends. */
  action: "local_retry" | "local_patch" | "escalate";
  /** α — diagnostic confidence in [0,1]. */
  confidence: number;
  errorClass: ErrorClass;
}

export interface RecoveryAttempt {
  attempt: number;
  level: RecoveryLevel;
  errorClass: ErrorClass;
  /** FULL error text. Diagnostic context only — never enters chat history. */
  detail: string;
  delayMs?: number;
  patched?: boolean;
}

export interface RecoveryOutcome {
  ok: boolean;
  /** Execution-context payload. On failure this is the terse notice. */
  output: string;
  label: string;
  /** Total number of tool invocations made (>= 1). */
  attempts: number;
  level: RecoveryLevel;
  finalState: RecoveryState;
  diagnosis?: Diagnosis;
  /** FULL failure detail. Diagnostic context only. */
  detail?: string;
  attemptLog: RecoveryAttempt[];
}

export interface RecoveryDeps {
  /**
   * Execute the tool once. MUST throw on failure — a returned string is taken
   * as success, so callers must not swallow errors into their return value.
   */
  run: (args: Record<string, unknown>) => Promise<{ output: string; label: string }>;
  /**
   * Deterministic argument repair for level 2. Return `null` when no repair
   * applies (the protocol then treats level 2 as vacuously exhausted).
   */
  patch?: (
    args: Record<string, unknown>,
  ) => Record<string, unknown> | null;
  /** Diagnostic sink. Receives FULL detail. Must never throw. */
  onDiagnostic?: (event: Record<string, unknown>) => void;
  /** Injectable sleep, so tests do not wait on real timers. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Per-call override of the level-1 retry budget.
   *
   * Pass 0 for calls that are NOT idempotent. Silently repeating a call that
   * already had its side effect — an ingest into the accumulating graph, a
   * recorded scenario turn, an external write — is worse than escalating, and
   * the engine cannot tell whether the effect landed before the transport
   * failed. Non-idempotent failures go straight to level 3 with a notice that
   * says so, leaving the decision to the model.
   */
  retryBudget?: number;
  /** Enclosing request cancellation stops the ladder immediately. */
  signal?: AbortSignal;
}

export interface RecoveryConfig {
  /** Level-1 retry budget (number of RE-tries, excluding the first attempt). */
  retryBudget: number;
  /** Base backoff delay; attempt n waits baseDelayMs * 2^(n-1). */
  baseDelayMs: number;
  /** Hard cap on the escalation notice that enters chat history. */
  maxNoticeChars: number;
  /** Run-log id, quoted in the notice so a human can find the full detail. */
  runId?: string;
}

export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  retryBudget: 2,
  baseDelayMs: 250,
  maxNoticeChars: 400,
};

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Auth failures are checked FIRST and classified structural, not transient.
 * A 401 will never succeed on retry, and burning the retry budget on it just
 * adds latency before the inevitable escalation. (This deviates deliberately
 * from the source paper, which files auth under level-2 patch; we have no
 * mechanism that can repair a credential from inside the loop.)
 */
const AUTH_RE =
  /\b(401|403)\b|unauthor|forbidden|invalid[_ -]?(api[_ -]?)?key|authentication fail|permission denied|not permitted/i;

/** Retryable: the call may plausibly succeed if repeated unchanged. */
const TRANSIENT_RE =
  /\b(429|500|502|503|504)\b|etimedout|econnreset|econnrefused|econnaborted|enotfound|eai_again|epipe|socket hang up|network (error|failure)|fetch failed|timed? ?out|temporarily|try again|rate.?limit|too many requests|overloaded|server error|bad gateway|service unavailable|gateway timeout|stream (ended|closed) unexpectedly/i;

/** Repairable: the call shape is wrong but the intent is recoverable. */
const SCHEMA_RE =
  // Note: no leading `-` in the JSON-RPC codes. `\b` needs a word/non-word
  // transition, and there is none between a space and a `-`, so `\b-32602`
  // never matches. `\b32602` does, in both "-32602" and "32602".
  // (-32601 "method not found" is deliberately absent: that is structural.)
  /\b(32602|32700|400|422)\b|invalid[_ -]?(type|param|argument|input|arg)|validation (error|failed)|schema|required (property|field|argument|parameter)|missing (required|property|field|argument|parameter)|unexpected (argument|parameter|key|property)|unknown (argument|parameter|field)|expected .* (but )?(received|got)|must be (a|an|of type)|does not match|failed to parse (arguments|input)|is not of a type/i;

/**
 * classifyError(err) — map a thrown value onto a recovery class.
 *
 * Order matters: auth (structural) beats transient, and transient beats
 * schema, because a 503 body can incidentally contain the word "invalid".
 * Anything unrecognised is `structural` — the conservative choice, since
 * structural means "do not retry, escalate now".
 */
export function classifyError(err: unknown): ErrorClass {
  if (
    err instanceof Error &&
    (err as Error & { scope?: unknown }).scope === "request"
  ) {
    return "cancelled";
  }
  const text = classifiableText(err);
  if (AUTH_RE.test(text)) return "structural";
  if (TRANSIENT_RE.test(text)) return "transient";
  if (SCHEMA_RE.test(text)) return "schema";
  return "structural";
}

/**
 * The subset of an error that may be pattern-matched for classification.
 *
 * Deliberately EXCLUDES the stack trace. A stack contains `file.ts:503:12`
 * frames, and the transient pattern looks for bare status codes like 503 — so
 * matching against the stack silently reclassified structural failures as
 * transient and retried calls that could never succeed. Classify on the
 * message and on explicit code/status fields only.
 */
function classifiableText(err: unknown): string {
  if (err === null || err === undefined) return "";
  if (err instanceof Error) {
    const e = err as Error & {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
    };
    const fields = [e.code, e.status, e.statusCode]
      .filter((v) => v !== undefined && v !== null)
      .map((v) => String(v))
      .join(" ");
    const causeMsg =
      e.cause instanceof Error
        ? ` ${e.cause.name}: ${e.cause.message}`
        : e.cause !== undefined && e.cause !== null
          ? ` ${String(e.cause)}`
          : "";
    return `${e.name}: ${e.message}${causeMsg} ${fields}`.trim();
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Full, untruncated error text — diagnostic context only. */
export function errorText(err: unknown): string {
  if (err === null || err === undefined) return "unknown error";
  if (err instanceof Error) {
    const cause =
      err.cause !== undefined && err.cause !== null
        ? `\ncaused by: ${String((err.cause as Error)?.message ?? err.cause)}`
        : "";
    return `${err.name}: ${err.message}${cause}${err.stack ? `\n${err.stack}` : ""}`;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** One-line, length-capped summary safe for the execution context. */
export function terseError(err: unknown, max = 160): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : errorText(err);
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Build the structured diagnosis for a failure. */
export function diagnose(err: unknown, errorClass: ErrorClass): Diagnosis {
  switch (errorClass) {
    case "cancelled":
      return {
        phi: terseError(err),
        cause: "The enclosing chat request reached its wall-clock deadline.",
        action: "escalate",
        confidence: 1,
        errorClass,
      };
    case "transient":
      return {
        phi: terseError(err),
        cause: "Transient fault (network, timeout, rate limit, or 5xx).",
        action: "local_retry",
        confidence: 0.8,
        errorClass,
      };
    case "schema":
      return {
        phi: terseError(err),
        cause: "Argument shape rejected by the tool's schema.",
        action: "local_patch",
        confidence: 0.7,
        errorClass,
      };
    default:
      return {
        phi: terseError(err),
        cause:
          "Structural fault (unknown tool, auth failure, or invalid request) — not repairable in-loop.",
        action: "escalate",
        confidence: 0.6,
        errorClass,
      };
  }
}

// ---------------------------------------------------------------------------
// Stable call key — identifies "the same call" across attempts
// ---------------------------------------------------------------------------

/** Deterministic JSON with sorted keys, so key order cannot change the hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** FNV-1a 32-bit. Fast, dependency-free, adequate for a ledger key. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Ledger key for a (tool, args) pair. Exported for tests and log correlation. */
export function callKey(tool: string, args: Record<string, unknown>): string {
  let hashed: string;
  try {
    hashed = fnv1a(stableStringify(args));
  } catch {
    hashed = "unhashable";
  }
  return `${tool}:${hashed}`;
}

// ---------------------------------------------------------------------------
// RecoveryProtocol
// ---------------------------------------------------------------------------

/** Thrown when a caller tries to skip an escalation level. */
export class EscalationViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EscalationViolationError";
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * RecoveryProtocol — one instance per chat run.
 *
 * Holds the recovery-state ledger for the run, so a tool that has already
 * burned its retries on one set of arguments cannot silently burn them again
 * later in the same run under the same arguments.
 */
export class RecoveryProtocol {
  readonly #config: RecoveryConfig;
  readonly #ledger = new Map<string, RecoveryState>();

  constructor(config: Partial<RecoveryConfig> = {}) {
    this.#config = { ...DEFAULT_RECOVERY_CONFIG, ...config };
  }

  /** Current escalation state for a call. Exposed for tests and audit. */
  getState(tool: string, args: Record<string, unknown>): RecoveryState {
    return this.#ledger.get(callKey(tool, args)) ?? "pristine";
  }

  /** Full ledger snapshot, for the run-log summary. */
  snapshot(): Record<string, RecoveryState> {
    return Object.fromEntries(this.#ledger);
  }

  #advance(key: string, to: RecoveryState): void {
    const current = this.#ledger.get(key) ?? "pristine";
    if (STATE_RANK[to] > STATE_RANK[current]) this.#ledger.set(key, to);
  }

  /** Precondition for level 2 (§6.2): level 1 must be exhausted. */
  #assertCanPatch(key: string): void {
    const state = this.#ledger.get(key) ?? "pristine";
    if (STATE_RANK[state] < STATE_RANK.retried) {
      throw new EscalationViolationError(
        `local_patch requires recoveryState >= retried for ${key} (was ${state})`,
      );
    }
  }

  /** Precondition for level 3 (§6.2): levels 1 and 2 must be exhausted. */
  #assertCanEscalate(key: string): void {
    const state = this.#ledger.get(key) ?? "pristine";
    if (STATE_RANK[state] < STATE_RANK.patched) {
      throw new EscalationViolationError(
        `escalate requires recoveryState >= patched for ${key} (was ${state})`,
      );
    }
  }

  /**
   * Execute a tool under the bounded recovery ladder.
   *
   * Never throws: every failure path ends in a level-3 escalation outcome.
   * `outcome.output` is safe for chat history; `outcome.detail` is not.
   */
  async execute(
    tool: string,
    args: Record<string, unknown>,
    deps: RecoveryDeps,
  ): Promise<RecoveryOutcome> {
    const key = callKey(tool, args);
    const sleep = deps.sleep ?? defaultSleep;
    const retryBudget = Math.max(
      0,
      deps.retryBudget ?? this.#config.retryBudget,
    );
    const emit = (event: Record<string, unknown>): void => {
      try {
        deps.onDiagnostic?.({ tool, key, ...event });
      } catch {
        /* diagnostics must never break execution */
      }
    };

    const attemptLog: RecoveryAttempt[] = [];
    let currentArgs = args;
    let attempts = 0;
    let level: RecoveryLevel = 0;
    let lastErr: unknown;
    let lastClass: ErrorClass = "structural";

    // ── Level 0/1: initial attempt plus bounded transient retries ──────────
    for (let i = 0; i <= retryBudget; i++) {
      attempts++;
      try {
        const { output, label } = await deps.run(currentArgs);
        if (i > 0) emit({ event: "recovery_succeeded", level, attempts });
        return {
          ok: true,
          output,
          label,
          attempts,
          level,
          finalState: this.getState(tool, args),
          attemptLog,
        };
      } catch (err) {
        lastErr = err;
        lastClass = classifyError(err);
        const detail = errorText(err);
        const isLast = i === retryBudget;
        const willRetry =
          lastClass === "transient" && !isLast && !deps.signal?.aborted;
        const delayMs = willRetry
          ? this.#config.baseDelayMs * Math.pow(2, i)
          : undefined;

        attemptLog.push({
          attempt: attempts,
          level: willRetry ? 1 : level,
          errorClass: lastClass,
          detail,
          delayMs,
        });
        emit({
          event: "tool_failed",
          attempt: attempts,
          errorClass: lastClass,
          willRetry,
          detail,
        });

        // Request cancellation is not a defect in this tool or its provider,
        // and no recovery level can extend the enclosing request. Return
        // immediately without mutating the retry/patch ledger.
        if (lastClass === "cancelled") {
          const diagnosis = diagnose(lastErr, lastClass);
          emit({
            event: "request_cancelled_tool",
            attempt: attempts,
            diagnosis,
            detail,
          });
          return {
            ok: false,
            output: this.#notice(tool, diagnosis, attempts),
            label: tool,
            attempts,
            level: 0,
            finalState: this.getState(tool, args),
            diagnosis,
            detail,
            attemptLog,
          };
        }

        if (!willRetry) break;
        level = 1;
        this.#advance(key, "retried");
        await sleep(delayMs as number);
      }
    }

    // Level 1 is now exhausted, either by budget or by non-transient class.
    // Mark it so, recording WHY, so the audit trail shows the invariant held.
    if (lastClass !== "transient") {
      emit({
        event: "level_skipped",
        level: 1,
        reason: `error class '${lastClass}' is not retryable`,
      });
    } else if (retryBudget === 0) {
      emit({
        event: "level_skipped",
        level: 1,
        reason:
          "retry budget 0 — call is not idempotent, engine-side retry withheld",
      });
    }
    this.#advance(key, "retried");
    if (level < 1) level = 1;

    // ── Level 2: deterministic argument repair, then one re-run ────────────
    const patched =
      lastClass === "schema" && deps.patch ? safePatch(deps.patch, currentArgs) : null;

    if (patched && stableStringify(patched) !== stableStringify(currentArgs)) {
      this.#assertCanPatch(key);
      level = 2;
      attempts++;
      emit({ event: "recovery_patch", from: currentArgs, to: patched });
      try {
        const { output, label } = await deps.run(patched);
        this.#advance(key, "patched");
        emit({ event: "recovery_succeeded", level: 2, attempts });
        return {
          ok: true,
          output,
          label,
          attempts,
          level,
          finalState: this.getState(tool, args),
          attemptLog,
        };
      } catch (err) {
        lastErr = err;
        lastClass = classifyError(err);
        attemptLog.push({
          attempt: attempts,
          level: 2,
          errorClass: lastClass,
          detail: errorText(err),
          patched: true,
        });
        emit({
          event: "tool_failed",
          attempt: attempts,
          level: 2,
          errorClass: lastClass,
          detail: errorText(err),
        });
      }
    } else {
      emit({
        event: "level_skipped",
        level: 2,
        reason:
          lastClass !== "schema"
            ? `error class '${lastClass}' is unpatchable`
            : "no deterministic repair applies to these arguments",
      });
    }
    this.#advance(key, "patched");

    // ── Level 3: escalate to the model, terse and structured ──────────────
    this.#assertCanEscalate(key);
    level = 3;
    const diagnosis = diagnose(lastErr, lastClass);
    const detail = errorText(lastErr);
    emit({ event: "recovery_escalated", diagnosis, attempts, detail });

    return {
      ok: false,
      output: this.#notice(tool, diagnosis, attempts),
      label: tool,
      attempts,
      level,
      finalState: this.getState(tool, args),
      diagnosis,
      detail,
      attemptLog,
    };
  }

  /**
   * The ONLY failure text permitted into the execution context.
   *
   * Deliberately terse and single-line: it states what failed, how hard the
   * engine already tried, and what the model may do next. It carries no stack,
   * no response body and no prior-failure narrative — that is diagnostic
   * context, and letting it accumulate in history is exactly the leak the
   * context partition exists to prevent.
   */
  #notice(tool: string, d: Diagnosis, attempts: number): string {
    const where = this.#config.runId ? ` See run log ${this.#config.runId}.` : "";
    const guidance =
      d.errorClass === "cancelled"
        ? "Continue verification in a new request using the persisted engine state."
        : d.errorClass === "schema"
        ? "Fix the argument shape and call it at most once more, or proceed without this tool."
        : d.errorClass === "transient"
          ? attempts > 1
            ? "The engine already retried; treat the tool as unavailable for now and proceed without it."
            : // Not retried because the call is not idempotent — repeating it
              // could double-apply a side effect. The model owns this decision.
              "Not retried automatically: repeating this call could duplicate its effect. Repeat it only if you are sure that is safe, otherwise proceed without it."
          : "This will not succeed on retry. Proceed without this tool and say so in your answer.";
    const head =
      d.errorClass === "cancelled"
        ? `[tool_cancelled] ${tool} — request deadline, ${attempts} attempt(s). `
        : `[tool_failed] ${tool} — ${d.errorClass}, ${attempts} attempt(s), recovery exhausted through L2. `;
    const tail = ` ${guidance} Do not fabricate this tool's result.${where}`;

    // Give φ whatever budget is left after the parts the model actually acts
    // on. Truncating the notice as a whole would drop the guidance and the
    // run-log pointer whenever an upstream error message happened to be long
    // — exactly backwards.
    const phiBudget = Math.max(
      40,
      this.#config.maxNoticeChars - head.length - tail.length,
    );
    const phi =
      d.phi.length > phiBudget ? `${d.phi.slice(0, phiBudget - 1)}…` : d.phi;
    return head + phi + tail;
  }
}

/** A throwing patch function must not take down the recovery ladder. */
function safePatch(
  patch: NonNullable<RecoveryDeps["patch"]>,
  args: Record<string, unknown>,
): Record<string, unknown> | null {
  try {
    return patch(structuredClone(args));
  } catch {
    return null;
  }
}
