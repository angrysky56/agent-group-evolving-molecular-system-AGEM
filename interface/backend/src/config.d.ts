/**
 * AGEM Backend Configuration Service.
 *
 * Manages environment variables and runtime settings for LLM providers,
 * knowledge base paths, and server configuration.
 * Uses Zod for validation and dotenv for environment loading.
 */
import { z } from "zod";
import type { LLMProviderType, SystemConfig } from "../../shared/types.js";
/** Zod schema for validated configuration. */
declare const ConfigSchema: z.ZodObject<{
    PORT: z.ZodDefault<z.ZodNumber>;
    HOST: z.ZodDefault<z.ZodString>;
    LLM_PROVIDER: z.ZodType<LLMProviderType>;
    EMBEDDING_PROVIDER: z.ZodType<LLMProviderType | undefined>;
    OLLAMA_BASE_URL: z.ZodDefault<z.ZodString>;
    OLLAMA_MODEL: z.ZodDefault<z.ZodString>;
    OLLAMA_EMBEDDING_MODEL: z.ZodDefault<z.ZodString>;
    OPENROUTER_API_KEY: z.ZodDefault<z.ZodString>;
    OPENROUTER_BASE_URL: z.ZodDefault<z.ZodString>;
    OPENROUTER_MODEL: z.ZodDefault<z.ZodString>;
    OPENROUTER_EMBEDDING_MODEL: z.ZodDefault<z.ZodString>;
    ANTHROPIC_API_KEY: z.ZodDefault<z.ZodString>;
    ANTHROPIC_BASE_URL: z.ZodDefault<z.ZodString>;
    ANTHROPIC_MODEL: z.ZodDefault<z.ZodString>;
    ANTHROPIC_EMBEDDING_MODEL: z.ZodDefault<z.ZodString>;
    MINIMAX_API_KEY: z.ZodDefault<z.ZodString>;
    MINIMAX_GROUP_ID: z.ZodDefault<z.ZodString>;
    MINIMAX_BASE_URL: z.ZodDefault<z.ZodString>;
    MINIMAX_MODEL: z.ZodDefault<z.ZodString>;
    MINIMAX_EMBEDDING_MODEL: z.ZodDefault<z.ZodString>;
    KNOWLEDGE_BASE_PATH: z.ZodDefault<z.ZodString>;
    MAX_AGENT_POOL_SIZE: z.ZodDefault<z.ZodNumber>;
    MAX_ITERATIONS: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    PORT: number;
    HOST: string;
    OLLAMA_BASE_URL: string;
    OLLAMA_MODEL: string;
    OLLAMA_EMBEDDING_MODEL: string;
    OPENROUTER_API_KEY: string;
    OPENROUTER_BASE_URL: string;
    OPENROUTER_MODEL: string;
    OPENROUTER_EMBEDDING_MODEL: string;
    ANTHROPIC_API_KEY: string;
    ANTHROPIC_BASE_URL: string;
    ANTHROPIC_MODEL: string;
    ANTHROPIC_EMBEDDING_MODEL: string;
    MINIMAX_API_KEY: string;
    MINIMAX_GROUP_ID: string;
    MINIMAX_BASE_URL: string;
    MINIMAX_MODEL: string;
    MINIMAX_EMBEDDING_MODEL: string;
    KNOWLEDGE_BASE_PATH: string;
    MAX_AGENT_POOL_SIZE: number;
    MAX_ITERATIONS: number;
    LLM_PROVIDER: LLMProviderType;
    EMBEDDING_PROVIDER?: LLMProviderType | undefined;
}, {
    LLM_PROVIDER: LLMProviderType;
    PORT?: number | undefined;
    HOST?: string | undefined;
    OLLAMA_BASE_URL?: string | undefined;
    OLLAMA_MODEL?: string | undefined;
    OLLAMA_EMBEDDING_MODEL?: string | undefined;
    OPENROUTER_API_KEY?: string | undefined;
    OPENROUTER_BASE_URL?: string | undefined;
    OPENROUTER_MODEL?: string | undefined;
    OPENROUTER_EMBEDDING_MODEL?: string | undefined;
    ANTHROPIC_API_KEY?: string | undefined;
    ANTHROPIC_BASE_URL?: string | undefined;
    ANTHROPIC_MODEL?: string | undefined;
    ANTHROPIC_EMBEDDING_MODEL?: string | undefined;
    MINIMAX_API_KEY?: string | undefined;
    MINIMAX_GROUP_ID?: string | undefined;
    MINIMAX_BASE_URL?: string | undefined;
    MINIMAX_MODEL?: string | undefined;
    MINIMAX_EMBEDDING_MODEL?: string | undefined;
    KNOWLEDGE_BASE_PATH?: string | undefined;
    MAX_AGENT_POOL_SIZE?: number | undefined;
    MAX_ITERATIONS?: number | undefined;
    EMBEDDING_PROVIDER?: LLMProviderType | undefined;
}>;
type Config = z.infer<typeof ConfigSchema>;
/** Singleton configuration instance. */
declare class ConfigService {
    #private;
    constructor();
    /** Get the entire configuration. */
    get all(): Readonly<Config>;
    /** Get configuration for a specific provider or the active one. */
    getLLMConfig(type?: LLMProviderType): {
        provider: LLMProviderType;
        api_key: string;
        base_url: string;
        model: string;
        embedding_model: string;
    };
    /** Export as SystemConfig for the API. */
    toSystemConfig(): SystemConfig;
    /** Update configuration at runtime and persist to .env. */
    update(updates: Partial<Config>): boolean;
}
/** Singleton config instance. */
export declare const settings: ConfigService;
export {};
//# sourceMappingURL=config.d.ts.map