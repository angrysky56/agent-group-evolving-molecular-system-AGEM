/**
 * ProviderCompressor -- production ICompressor that calls the backend
 * LLM provider (Ollama or OpenRouter) to summarize and compress context.
 *
 * Failure modes hardened in this version:
 *   1. compress() -- when the provider returns empty content, falls back to
 *      sentence-boundary truncation (not mid-character slicing) so the
 *      summary at least ends cleanly. When no boundary exists in the target
 *      window, the full text is returned -- text salad poisons embeddings
 *      worse than length excess.
 *   2. generateReflections() -- mid-tier models routinely emit JSON with
 *      trailing commas, single quotes, or surrounding prose. We delegate
 *      extraction/repair to src/lcm/jsonRepair (which is unit-tested
 *      against real failure shapes from cycle logs) and retry once with a
 *      stricter prompt on first failure.
 */

import type { ICompressor } from "#agem/lcm/interfaces.js";
import {
  extractJsonArray,
  sentenceBoundaryTruncate,
} from "#agem/lcm/jsonRepair.js";
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
        messages: [{ role: "user", content: prompt }],
      });

      if (!response.content || response.content.trim().length === 0) {
        throw new Error("Provider returned empty content");
      }

      return response.content.trim();
    } catch (error) {
      console.error(
        "[ProviderCompressor] Error during compression, falling back to sentence-boundary truncation:",
        error,
      );
      return sentenceBoundaryTruncate(text, targetRatio);
    }
  }

  async generateReflections(
    text: string,
  ): Promise<Array<{ question: string; answer: string }>> {
    const prompt = `You are a highly precise learning agent. Analyze the following context summary and generate exactly 3 compositional Question-and-Answer (Q&A) pairs.
These Q&A pairs must reflect key facts, entities, logical relations, and inferences that can be derived from the text.
Generate one direct question, one indirect/inferred question, and one multi-hop/synthesis question.
Format your output exactly as a JSON array of objects, each containing "question" and "answer" keys. Output ONLY the JSON array, with no other text, markdown formatting, or code blocks.

Context:
${text}`;

    // First attempt.
    const firstAttempt = await this.#tryReflections(prompt);
    if (firstAttempt !== null) return firstAttempt;

    // Second attempt with a stricter reminder. Many mid models comply on the
    // retry when reminded explicitly that the previous response was malformed.
    const strictPrompt =
      prompt +
      `\n\nIMPORTANT: Your previous response could not be parsed as JSON. Return ONLY a single JSON array. No code fences. No explanation. Example shape: [{"question":"...","answer":"..."}]`;
    const secondAttempt = await this.#tryReflections(strictPrompt);
    if (secondAttempt !== null) return secondAttempt;

    // Give up. Empty reflections is safe: routing still works on the
    // root-summary embedding alone.
    console.error(
      "[ProviderCompressor] Reflections unparseable after retry; returning empty list",
    );
    return [];
  }

  async synthesize(query: string, context: string): Promise<string> {
    try {
      const config = settings.getLLMConfig();
      const provider = createProvider(config.provider);
      const prompt = `You are a highly precise synthesis agent. Answer the following user query based ONLY on the retrieved context below. Be extremely accurate, direct, and factual.

Query:
${query}

Retrieved Context:
${context}`;

      const response = await provider.chat({
        messages: [{ role: "user", content: prompt }],
      });

      return response.content.trim();
    } catch (error) {
      console.error("[ProviderCompressor] Error during synthesis:", error);
      return `Fallback Answer: Based on retrieved context: ${context.slice(0, 200)}...`;
    }
  }

  /**
   * #tryReflections -- single provider call with robust JSON extraction.
   * Returns the parsed array on success, null on any failure (so the caller
   * can decide whether to retry or give up).
   */
  async #tryReflections(
    prompt: string,
  ): Promise<Array<{ question: string; answer: string }> | null> {
    try {
      const config = settings.getLLMConfig();
      const provider = createProvider(config.provider);
      const response = await provider.chat({
        messages: [{ role: "user", content: prompt }],
      });

      const parsed = extractJsonArray(response.content ?? "");
      if (parsed === null) {
        console.warn(
          "[ProviderCompressor] Could not extract JSON array from reflections response",
        );
        return null;
      }

      return parsed.map((item: unknown) => {
        const obj = item as { question?: unknown; answer?: unknown };
        return {
          question: String(obj.question ?? ""),
          answer: String(obj.answer ?? ""),
        };
      });
    } catch (error) {
      console.warn(
        "[ProviderCompressor] Reflection attempt failed:",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }
}
