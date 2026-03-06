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

// Load .env from project root
dotenvConfig({ path: resolve(PROJECT_ROOT, ".env") });

/** Zod schema for validated configuration. */
const ConfigSchema = z.object({
  // Server
  PORT: z.coerce.number().default(8000),
  HOST: z.string().default("0.0.0.0"),

  // Active Provider
  LLM_PROVIDER: z
    .enum(["ollama", "openrouter"])
    .default("ollama") as z.ZodType<LLMProviderType>,

  // Ollama
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("gemma3:latest"),
  OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text:latest"),

  // OpenRouter
  OPENROUTER_API_KEY: z.string().default(""),
  OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
  OPENROUTER_MODEL: z.string().default("google/gemini-2.5-flash-preview"),
  OPENROUTER_EMBEDDING_MODEL: z.string().default("google/gemini-embedding-001"),

  // Knowledge Base
  KNOWLEDGE_BASE_PATH: z
    .string()
    .default(resolve(PROJECT_ROOT, "knowledge_base")),

  // AGEM Engine
  MAX_AGENT_POOL_SIZE: z.coerce.number().default(20),
  MAX_ITERATIONS: z.coerce.number().default(50),
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

  /** Get configuration for the active LLM provider. */
  getLLMConfig(): {
    provider: LLMProviderType;
    api_key: string;
    base_url: string;
    model: string;
    embedding_model: string;
  } {
    const provider = this.#config.LLM_PROVIDER;

    if (provider === "ollama") {
      return {
        provider,
        api_key: "",
        base_url: this.#config.OLLAMA_BASE_URL,
        model: this.#config.OLLAMA_MODEL,
        embedding_model: this.#config.OLLAMA_EMBEDDING_MODEL,
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
    return {
      provider: llm.provider,
      model: llm.model,
      embedding_model: llm.embedding_model,
      ollama_base_url: this.#config.OLLAMA_BASE_URL,
      openrouter_base_url: this.#config.OPENROUTER_BASE_URL,
      knowledge_base_path: this.#config.KNOWLEDGE_BASE_PATH,
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
