/**
 * ProviderCompressor — production ICompressor that calls the backend
 * LLM provider (Ollama or OpenRouter) to summarize and compress context.
 *
 * Falls back to character-wise truncation if the provider call fails.
 */

import type { ICompressor } from "#agem/lcm/interfaces.js";
import { createProvider } from "./llm.js";
import { settings } from "../config.js";

export class ProviderCompressor implements ICompressor {
  async compress(text: string, targetRatio: number): Promise<string> {
    try {
      const config = settings.getLLMConfig();
      const provider = createProvider(config.provider);
      const prompt = `You are a highly precise context compression agent.
Your goal is to compress the text below while preserving the original entities, logical relationships, axioms, and factual content.
Attempt to achieve a compression ratio of approximately ${targetRatio.toFixed(2)} (i.e. output size should be roughly ${Math.round(targetRatio * 100)}% of the original size).
Output ONLY the compressed summary content, with no introductory or concluding remarks.

Text to compress:
${text}`;

      const response = await provider.chat({
        messages: [{ role: "user", content: prompt }]
      });

      if (!response.content || response.content.trim().length === 0) {
        throw new Error("Provider returned empty content");
      }

      return response.content.trim();
    } catch (error) {
      console.error(
        "[ProviderCompressor] Error during compression, falling back to mock truncation:",
        error,
      );
      // Fallback: truncate character-wise as a safe recovery
      const targetLength = Math.max(1, Math.floor(text.length * targetRatio));
      return text.slice(0, targetLength);
    }
  }
}
