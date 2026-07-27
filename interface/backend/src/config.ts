/**
 * AGEM Backend Configuration Service.
 *
 * Manages environment variables and runtime settings for LLM providers,
 * knowledge base paths, and server configuration.
 * Uses Zod for validation and dotenv for environment loading.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";
import { z } from "zod";
import type { LLMProviderType, SystemConfig } from "../../shared/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");

/*
 * Load .env from project root, and let it WIN over an inherited environment.
 *
 * `override: true` matters because the settings UI writes .env — that file is
 * the source of truth for this app, not the shell. Without the override, a
 * variable exported once in the terminal that launched start.sh outranks every
 * later edit, and nothing surfaces the conflict: the UI saves happily, the file
 * on disk is correct, a fresh script reads the new value, and only the running
 * server disagrees. Observed exactly that with EMBEDDING_PROVIDER — a stale
 * `ollama` from a launch shell survived a model switch in the UI, repeated
 * .env edits, and several tsx-watch reloads, because `tsx watch` restarts only
 * the child and the child inherits the parent's frozen environment.
 *
 * To point the app at a different .env, pass a different path; to override a
 * single value for one run, edit .env rather than exporting.
 */
dotenvConfig({ path: resolve(PROJECT_ROOT, ".env"), override: true });

/** Zod schema for validated configuration. */
const ConfigSchema = z.object({
  // Server
  PORT: z.coerce.number().default(8000),
  HOST: z.string().default("0.0.0.0"),

  // Active Provider
  LLM_PROVIDER: z
    .enum(["ollama", "openrouter", "anthropic", "minimax"])
    .default("ollama") as z.ZodType<LLMProviderType>,
  EMBEDDING_PROVIDER: z
    .enum(["ollama", "openrouter", "anthropic", "minimax"])
    .optional() as z.ZodType<LLMProviderType | undefined>,

  // Ollama
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("gemma3:latest"),
  OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text:latest"),

  // OpenRouter
  OPENROUTER_API_KEY: z.string().default(""),
  OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
  OPENROUTER_MODEL: z.string().default("google/gemini-2.5-flash-preview"),
  OPENROUTER_EMBEDDING_MODEL: z
    .string()
    .default("nvidia/nemotron-3-embed-1b:free"),
  /*
   * Output cap for OpenRouter completions.
   *
   * Was 16384, which silently truncated long analyses — the provider reports
   * finish_reason=length and the run continues with a cut-off answer. The
   * configured model advertises far more headroom than that: as measured from
   * OpenRouter's /models, deepseek-v4-flash allows 393,216 completion tokens
   * against a 1,048,576 context. 32768 is a working default rather than a
   * ceiling; raise it here or in .env if a report is still being cut short.
   */
  OPENROUTER_MAX_TOKENS: z.coerce.number().int().positive().default(32768),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_BASE_URL: z.string().default("https://api.anthropic.com/v1"),
  ANTHROPIC_MODEL: z.string().default("claude-3-5-sonnet-20241022"),
  ANTHROPIC_EMBEDDING_MODEL: z.string().default(""),
  /** Was hardcoded in AnthropicProvider with no way to change it. */
  ANTHROPIC_MAX_TOKENS: z.coerce.number().int().positive().default(8192),

  // MiniMax
  MINIMAX_API_KEY: z.string().default(""),
  MINIMAX_GROUP_ID: z.string().default(""),
  MINIMAX_BASE_URL: z.string().default("https://api.minimax.chat/v1"),
  MINIMAX_MODEL: z.string().default("abab6.5s-chat"),
  MINIMAX_EMBEDDING_MODEL: z.string().default("embo-01"),

  // Knowledge Base
  KNOWLEDGE_BASE_PATH: z
    .string()
    .default(resolve(PROJECT_ROOT, "knowledge_base")),

  // TypeDB claim store (OPTIONAL — AGEM runs fine without it)
  /**
   * Enable the schema-enforced claim store. When false, or when no server is
   * reachable, AGEM degrades to concept-graph-only operation and logs a note.
   * A missing database must never take the reasoning engine offline.
   */
  TYPEDB_ENABLED: z
    .union([z.boolean(), z.string()])
    .default("true")
    .transform((v) => (typeof v === "boolean" ? v : v !== "false" && v !== "0")),
  /**
   * TypeDB HTTP endpoint. NOTE this is the HTTP port, not gRPC 1729 — the
   * TypeScript path for TypeDB 3.x is the HTTP driver (@typedb/driver-http);
   * the gRPC Node driver (npm `typedb-driver`) is 2.x-only and will not talk
   * to a 3.x server. TypeDB defaults HTTP to 8000, which collides with AGEM's
   * own backend PORT, so start the server with
   *   typedb server --server.http.listen-address 0.0.0.0:8100
   */
  TYPEDB_ADDRESS: z.string().default("http://127.0.0.1:8100"),
  TYPEDB_DATABASE: z.string().default("agem-claims"),
  TYPEDB_USERNAME: z.string().default("admin"),
  TYPEDB_PASSWORD: z.string().default("password"),

  // Automatic cross-run finding memory
  /** Raw cosine floor. Below this, recall returns nothing regardless of top-k. */
  FINDING_RECALL_SIMILARITY_FLOOR: z.coerce.number().min(-1).max(1).default(0.4),
  /** Hard upper bound on findings injected into one run. */
  FINDING_RECALL_TOP_K: z.coerce.number().int().min(1).default(3),
  /**
   * Findings with no recalls and no citations leave the hot index after this
   * many days. They are appended to the archive, never deleted.
   */
  FINDING_UNUSED_RETENTION_DAYS: z.coerce.number().int().min(1).default(180),
  /** Absolute bound on the cosine-scanned hot index. Overflow sinks first. */
  FINDING_MAX_ACTIVE: z.coerce.number().int().min(1).default(500),
  /** Optional payload compression. Recall always embeds the verbatim verdict. */
  FINDING_DENSIFICATION_ENABLED: z
    .union([z.boolean(), z.string()])
    .default("true")
    .transform((v) => (typeof v === "boolean" ? v : v !== "false" && v !== "0")),
  /** BabelTele payload target, relative to evidence plus schema facts. */
  FINDING_DENSIFICATION_TARGET_RATIO: z.coerce
    .number()
    .min(0.05)
    .max(0.95)
    .default(0.28),
  /** Bounded CoD revisions. Each pass is one provider call. */
  FINDING_DENSIFICATION_MAX_PASSES: z.coerce
    .number()
    .int()
    .min(1)
    .max(8)
    .default(3),
  /** Refuse rather than silently truncate an oversized evidence narrative. */
  FINDING_DENSIFICATION_MAX_SOURCE_TOKENS: z.coerce
    .number()
    .int()
    .min(128)
    .default(8192),
  /** Absolute ceiling for the optional stored payload. */
  FINDING_DENSIFICATION_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(64)
    .default(2048),
  /** Prevent a schema-only or one-token payload from looking successful. */
  FINDING_DENSIFICATION_MIN_NARRATIVE_TOKENS: z.coerce
    .number()
    .int()
    .min(1)
    .default(16),

  /*
   * Depth-of-search budgets for the logic layer.
   *
   * These were hardcoded constants, and every one of them was eventually found
   * to be silently truncating real work: a 400-check budget stopped the arity-4
   * search dead on every real corpus, and an arity cap of 4 left a 64-subset
   * lattice unfinished against a 5000-check budget. AGEM is for deep thinking;
   * these should be generous by default and raisable without a code change.
   *
   * Cost note: with the mcp-logic oracle each check is an MCP round-trip to a
   * Prover9/Mace4 subprocess, so wall-clock scales with the budget. Raise
   * deliberately, and prefer letting a search finish to getting a fast answer
   * carrying a "not ruled out" caveat.
   */
  LOGIC_MAX_CHECKS: z.coerce.number().min(1).default(50000),
  /** Highest subset size to test. Small lattices auto-exhaust regardless. */
  LOGIC_MAX_ARITY: z.coerce.number().min(2).default(6),
  /**
   * Ceiling on distinct claim blocks fed to the consistency search. Extraction
   * decides how many blocks exist, unlike the hand-curated path, so this is the
   * only guard against a corpus producing hundreds. Exceeding it is reported,
   * never silent.
   */
  LOGIC_MAX_BLOCKS: z.coerce.number().min(2).default(120),
  /** Output budget per claim-extraction batch. Truncation silently voids a batch. */
  EXTRACTION_MAX_TOKENS: z.coerce.number().min(1024).default(32768),

  // AGEM Engine
  MAX_AGENT_POOL_SIZE: z.coerce.number().default(20),
  MAX_ITERATIONS: z.coerce.number().default(50),
  /** Maximum reasoning steps per VdW agent before self-termination. Default: 50 */
  VDW_AGENT_MAX_ITERATIONS: z.coerce.number().default(50),
  /** Maximum tool execution turns in a chat session before forcing completion. Default: 30 */
  CHAT_MAX_TURNS: z.coerce.number().default(30),

  // Tool execution: bounded recovery + side-effect-aware dispatch
  /**
   * Level-1 retry budget per (tool, arguments) pair, for transient faults only
   * (network, timeout, rate limit, 5xx). Excludes the first attempt. Set to 0
   * to disable engine-side retries and escalate every failure to the model.
   * Default: 2
   */
  TOOL_RETRY_BUDGET: z.coerce.number().min(0).default(2),
  /**
   * Maximum read-only tool calls dispatched concurrently within one turn.
   * Mutating tools are always serial regardless of this value. Default: 4
   */
  TOOL_MAX_CONCURRENCY: z.coerce.number().min(1).default(4),
  /**
   * Enforce the workflow output contract (ingest → inspect → verify) before a
   * run may finish. When false, the model decides when it is done. Default: true
   */
  CHAT_ENFORCE_WORKFLOW_CONTRACT: z
    .union([z.boolean(), z.string()])
    .default("true")
    .transform((v) => (typeof v === "boolean" ? v : v !== "false" && v !== "0")),
  /**
   * User-message size (characters) at or above which a run counts as an
   * analysis even before the model has touched the engine. Below it, the
   * contract only activates once an analysis tool is actually used — so a
   * short maintenance command like "reset the engine" is never nudged to
   * ingest a corpus it does not have. Default: 600
   */
  CHAT_CONTRACT_MATERIAL_CHARS: z.coerce.number().min(0).default(600),

  /**
   * Token count of accumulated LCM context above which a compaction (an LLM
   * summarization call) is triggered.
   *
   * This is the most expensive knob in a reasoning cycle. It was hardcoded at
   * 1000 — smaller than a single paragraph of real material — so compaction
   * fired on every cycle. Measured: 49.2s of a 53.1s cycle, 93% of the total.
   *
   * The default is sized for modern context windows so that compaction is an
   * occasional consolidation rather than a per-cycle tax. Lower it if you are
   * running a small local model with a short context; raising it further keeps
   * more raw history at the cost of a larger (but rarer) compaction call.
   * Default: 32000
   *
   * ⚠ THIS KNOB MOVES H⁰. Measured on the same corpus with the same cycle-1
   * node count (169): at the old limit of 1000, compaction fired every cycle
   * and H⁰ ran 1 → 1 → 2 → 3; at 32000 it never fired and H⁰ was 3 from cycle
   * one. The sheaf is built by `buildSheafFromRegistry` over LCM subgraphs, so
   * the summary nodes that compaction creates change the base graph the
   * cohomology is computed over.
   *
   * That is a real coupling between a performance setting and a reported
   * metric, and it was undocumented. Consequence: H⁰ trajectories are only
   * comparable across runs that share this value. Do not read a change in H⁰
   * as a change in the material if this was retuned in between.
   */
  LCM_LEVEL1_TOKEN_LIMIT: z.coerce.number().min(256).default(32000),

  /**
   * Total accumulated LCM size at which consolidation is FORCED regardless of
   * regime — the genuine memory ceiling. Default: 32000
   */
  LCM_COMPACTION_CEILING_TOKENS: z.coerce.number().min(256).default(32000),
  /**
   * Minimum NEW material (tokens not yet folded into a summary) before
   * consolidation is worth doing. Prevents re-consolidating on every cycle.
   *
   * This exists because the LCM store is append-only: total size never falls,
   * so a total-size trigger can never un-fire. Gate on what is genuinely new.
   * Default: 4000
   */
  LCM_COMPACTION_MIN_NEW_TOKENS: z.coerce.number().min(64).default(4000),
  /**
   * Fraction of its own size that settled material is compressed to. Replaces
   * the old behaviour where one threshold was both the trigger and the target.
   * Default: 0.4
   */
  LCM_COMPACTION_TARGET_RATIO: z.coerce.number().min(0.05).max(0.95).default(0.4),
});

type Config = z.infer<typeof ConfigSchema>;

/** Singleton configuration instance. */
class ConfigService {
  #config: Config;

  constructor() {
    this.#config = ConfigSchema.parse(process.env);
  }

  /** Get the entire configuration. */
  get all(): Readonly<Config> {
    return this.#config;
  }

  /** Get configuration for a specific provider or the active one. */
  getLLMConfig(type?: LLMProviderType): {
    provider: LLMProviderType;
    api_key: string;
    base_url: string;
    model: string;
    embedding_model: string;
  } {
    const provider = type ?? this.#config.LLM_PROVIDER;

    if (provider === "ollama") {
      return {
        provider,
        api_key: "",
        base_url: this.#config.OLLAMA_BASE_URL,
        model: this.#config.OLLAMA_MODEL,
        embedding_model: this.#config.OLLAMA_EMBEDDING_MODEL,
      };
    }

    if (provider === "anthropic") {
      return {
        provider,
        api_key: this.#config.ANTHROPIC_API_KEY,
        base_url: this.#config.ANTHROPIC_BASE_URL,
        model: this.#config.ANTHROPIC_MODEL,
        embedding_model: this.#config.ANTHROPIC_EMBEDDING_MODEL,
      };
    }

    if (provider === "minimax") {
      return {
        provider,
        api_key: this.#config.MINIMAX_API_KEY,
        base_url: this.#config.MINIMAX_BASE_URL,
        model: this.#config.MINIMAX_MODEL,
        embedding_model: this.#config.MINIMAX_EMBEDDING_MODEL,
      };
    }

    return {
      provider,
      api_key: this.#config.OPENROUTER_API_KEY,
      base_url: this.#config.OPENROUTER_BASE_URL,
      model: this.#config.OPENROUTER_MODEL,
      embedding_model: this.#config.OPENROUTER_EMBEDDING_MODEL,
    };
  }

  /** Export as SystemConfig for the API. */
  toSystemConfig(): SystemConfig {
    const llm = this.getLLMConfig();
    const emb = this.getLLMConfig(
      this.#config.EMBEDDING_PROVIDER ?? llm.provider,
    );
    return {
      provider: llm.provider,
      embedding_provider: this.#config.EMBEDDING_PROVIDER ?? llm.provider,
      model: llm.model,
      embedding_model: emb.embedding_model,
      ollama_base_url: this.#config.OLLAMA_BASE_URL,
      openrouter_base_url: this.#config.OPENROUTER_BASE_URL,
      openrouter_max_tokens: this.#config.OPENROUTER_MAX_TOKENS,
      anthropic_max_tokens: this.#config.ANTHROPIC_MAX_TOKENS,
      minimax_base_url: this.#config.MINIMAX_BASE_URL,
      knowledge_base_path: this.#config.KNOWLEDGE_BASE_PATH,
      // Never expose the key itself — only whether one is configured
      has_api_key: llm.api_key.length > 0,
    };
  }

  /** Update configuration at runtime and persist to .env. */
  update(updates: Partial<Config>): boolean {
    try {
      // Merge and re-validate
      const merged = { ...this.#config, ...updates };
      this.#config = ConfigSchema.parse(merged);

      // Persist to .env file
      this.#persistToEnv(updates);
      return true;
    } catch (error) {
      console.error("[Config] Failed to update:", error);
      return false;
    }
  }

  /** Write updated keys to the .env file. */
  #persistToEnv(updates: Partial<Config>): void {
    /*
     * Never write the developer's real .env from a test run.
     *
     * config.test.ts exercises update() with `{ EMBEDDING_PROVIDER: "ollama" }`,
     * and update() persists — so every `npm test` silently rewrote the live
     * configuration file. That reverted a deliberate switch to OpenRouter ten
     * times over one session, and looked from the outside like the settings UI
     * fighting the user: the file kept changing back moments after being fixed,
     * with the test suite reporting all green each time.
     *
     * It matters beyond the annoyance. Embedding models differ in dimension
     * (embeddinggemma 768, nemotron 2048) and cosine() returns -1 on a
     * mismatch, so an unnoticed revert does not degrade finding recall — it
     * switches it off in silence.
     *
     * The in-memory update still happens; only the write is suppressed, so the
     * tests keep asserting exactly what they meant to assert.
     */
    if (process.env.VITEST || process.env.NODE_ENV === "test") return;

    const envPath = resolve(PROJECT_ROOT, ".env");
    let lines: string[] = [];

    if (existsSync(envPath)) {
      lines = readFileSync(envPath, "utf-8").split("\n");
    }

    const updatedKeys = new Set<string>();
    const newLines = lines.map((line) => {
      const [key] = line.split("=", 1);
      const trimmedKey = key?.trim();
      if (trimmedKey && trimmedKey in updates) {
        updatedKeys.add(trimmedKey);
        return `${trimmedKey}=${(updates as Record<string, unknown>)[trimmedKey]}`;
      }
      return line;
    });

    // Append new keys not already in the file
    for (const [key, value] of Object.entries(updates)) {
      if (!updatedKeys.has(key) && value !== undefined && value !== "") {
        newLines.push(`${key}=${value}`);
      }
    }

    writeFileSync(envPath, newLines.join("\n"), "utf-8");
  }
}

/** Singleton config instance. */
export const settings = new ConfigService();
