/**
 * LLM Provider Abstraction.
 *
 * Unified interface for Ollama (local) and OpenRouter (cloud) LLM providers.
 * Handles chat completions with streaming, model listing, and embeddings.
 */
import type { ModelInfo, LLMProviderType } from "../../../shared/types.js";
/** Callback for streaming token chunks. */
export type StreamCallback = (chunk: string) => void;
/** Callback for streaming thinking/reasoning chunks. */
export type ThinkingCallback = (chunk: string) => void;
/** Options for a chat completion request. */
export interface ChatCompletionOptions {
    messages: Array<{
        role: string;
        content: string | any[];
        tool_calls?: any[];
        tool_call_id?: string;
        name?: string;
        cache_control?: {
            type: "ephemeral";
        };
    }>;
    model?: string;
    tools?: any[];
    apiKey?: string;
    onToken?: StreamCallback;
    onThinking?: ThinkingCallback;
    onUsage?: (usage: ChatCompletionResult["usage"]) => void;
    signal?: AbortSignal;
}
/** Result of a chat completion. */
export interface ChatCompletionResult {
    content: string;
    thinking?: string;
    tool_calls?: any[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
    };
}
/** Abstract LLM provider interface. */
interface LLMProvider {
    readonly type: LLMProviderType;
    chat(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
    listModels(apiKey?: string): Promise<ModelInfo[]>;
    getEmbedding(text: string, model?: string, signal?: AbortSignal): Promise<number[]>;
}
/** Create the appropriate LLM provider based on configuration. */
export declare function createProvider(type?: LLMProviderType): LLMProvider;
export declare function getActiveProvider(): LLMProvider;
export type { LLMProvider };
//# sourceMappingURL=llm.d.ts.map