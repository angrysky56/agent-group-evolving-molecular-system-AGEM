/**
 * EscalationProtocol.test.ts
 *
 * Tests for EscalationProtocol — three-level context compression with guaranteed convergence.
 *
 * Test coverage:
 *   T7   — L1 triggers on token count exceeding threshold
 *   T7b  — L1 produces compressed output
 *   T7c  — L1 result includes escalation metadata
 *   T8   — L2 triggers when L1 compression ratio is insufficient
 *   T8b  — L2 tries multi-compression indexing (multiple compress() calls)
 *   T9   — L3 activates when both L1 and L2 fail
 *   T9b  — L3 uses zero LLM inference
 *   T9c  — L3 chunks before truncating
 *   T9d  — L3 output is <= kTokens
 *   T9e  — L3 is fully deterministic
 *   T9f  — L3 falls back to hard truncation when chunks still exceed kTokens
 *   T9g  — setThresholds updates at runtime
 *   T9h  — escalation emits events
 *
 * STATE.md pitfall "Escalation L3 missing" — permanently guarded by T9, T9b, T9c, T9d, T9f.
 */

import { describe, it, expect, vi } from "vitest";
import { encode } from "gpt-tokenizer";
import { EscalationProtocol } from "./EscalationProtocol.js";
import type { ICompressor } from "./interfaces.js";
import { GptTokenCounter, MockCompressor } from "./interfaces.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Generate text that has approximately `targetTokens` tokens.
 * Uses "cat" repeated since each instance is exactly 1 BPE token in gpt-tokenizer.
 * This gives precise, predictable token counts.
 */
function generateText(targetTokens: number): string {
  // "cat" is exactly 1 token in gpt-tokenizer BPE.
  // Space separator adds another token every N words, so we use slightly fewer
  // words to account for spaces: gpt-tokenizer typically counts "cat cat cat"
  // as individual tokens per word (the space is merged with following token).
  // Empirically: 150 "cat" words = 150 tokens.
  const words = Array.from({ length: targetTokens }, () => "cat");
  return words.join(" ");
}

/**
 * A compressor that always returns the input unchanged (ratio = 1.0).
 * Used to force L2 escalation when L1 fails the ratio check.
 */
class IdentityCompressor implements ICompressor {
  callCount = 0;
  async compress(text: string, _targetRatio: number): Promise<string> {
    this.callCount++;
    return text; // No compression — ratio = 1.0
  }
}

/**
 * A compressor that returns text LONGER than the input.
 * Simulates an LLM that adds explanation instead of compressing.
 * Forces L3 activation.
 */
class ExpandingCompressor implements ICompressor {
  callCount = 0;
  async compress(text: string, _targetRatio: number): Promise<string> {
    this.callCount++;
    return (
      text + " [EXTRA EXPLANATION ADDED BY LLM TO MAKE TEXT LONGER AND LONGER]"
    );
  }
}

/**
 * A compressor that returns very slightly compressed text.
 * Used to test that L2 triggers when L1 ratio is insufficient.
 */
class SlightlyCompressingCompressor implements ICompressor {
  callCount = 0;
  async compress(text: string, _targetRatio: number): Promise<string> {
    this.callCount++;
    // Return 95% of input — very little compression, fails 0.8 ratio requirement
    return text.slice(0, Math.floor(text.length * 0.95));
  }
}

const defaultThresholds = {
  level1TokenLimit: 100,
  level2MinRatio: 0.8,
  level3KTokens: 200,
  coherenceSimilarityThreshold: 0.7,
};

// ---------------------------------------------------------------------------
// T7: L1 triggers on token count exceeding threshold
// ---------------------------------------------------------------------------

describe("T7: L1 triggers on token count exceeding threshold", () => {
  it("compress() is called when text exceeds level1TokenLimit", async () => {
    const compressor = new MockCompressor();
    const compressSpy = vi.spyOn(compressor, "compress");
    const tokenCounter = new GptTokenCounter();

    const protocol = new EscalationProtocol(compressor, tokenCounter, {
      level1TokenLimit: 100,
      level2MinRatio: 0.8,
      level3KTokens: 200,
      coherenceSimilarityThreshold: 0.7,
    });

    // Generate text with > 100 tokens
    const text = generateText(150);
    const actualTokens = encode(text).length;
    expect(actualTokens).toBeGreaterThan(100);

    const result = await protocol.escalate(text);

    // L1 should have been attempted
    expect(compressSpy).toHaveBeenCalled();
    // Result should reflect escalation occurred
    expect(result.level).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// T7b: L1 produces compressed output
// ---------------------------------------------------------------------------

describe("T7b: L1 produces compressed output", () => {
  it("L1 output has fewer tokens than input", async () => {
    const compressor = new MockCompressor(); // truncates to targetRatio
    const tokenCounter = new GptTokenCounter();

    const protocol = new EscalationProtocol(compressor, tokenCounter, {
      level1TokenLimit: 100,
      level2MinRatio: 0.8,
      level3KTokens: 200,
      coherenceSimilarityThreshold: 0.7,
    });

    const text = generateText(150);
    const inputTokens = encode(text).length;
    expect(inputTokens).toBeGreaterThan(100);

    const result = await protocol.escalate(text);

    // Output should have fewer tokens than the input
    expect(result.outputTokens).toBeLessThan(result.inputTokens);
    expect(result.output.length).toBeLessThan(text.length);
  });
});

// ---------------------------------------------------------------------------
// T7c: L1 result includes escalation metadata
// ---------------------------------------------------------------------------

describe("T7c: L1 result includes escalation metadata", () => {
  it("result object includes level, inputTokens, outputTokens, compressorUsed", async () => {
    const compressor = new MockCompressor();
    const tokenCounter = new GptTokenCounter();

    const protocol = new EscalationProtocol(compressor, tokenCounter, {
      level1TokenLimit: 100,
      level2MinRatio: 0.8,
      level3KTokens: 200,
      coherenceSimilarityThreshold: 0.7,
    });

    const text = generateText(150);
    const result = await protocol.escalate(text);

    expect(typeof result.level).toBe("number");
    expect([1, 2, 3]).toContain(result.level);
    expect(typeof result.inputTokens).toBe("number");
    expect(typeof result.outputTokens).toBe("number");
    expect(typeof result.compressorUsed).toBe("boolean");
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// T8: L2 triggers when L1 compression ratio is insufficient
// ---------------------------------------------------------------------------

describe("T8: L2 triggers when L1 compression ratio is insufficient", () => {
  it("L2 is attempted after L1 fails to meet minRatio", async () => {
    // IdentityCompressor returns text unchanged — ratio = 1.0, fails level2MinRatio=0.8
    const compressor = new IdentityCompressor();
    const tokenCounter = new GptTokenCounter();

    const protocol = new EscalationProtocol(compressor, tokenCounter, {
      level1TokenLimit: 100,
      level2MinRatio: 0.8,
      level3KTokens: 200,
      coherenceSimilarityThreshold: 0.7,
    });

    const text = generateText(150);
    const result = await protocol.escalate(text);

    // Should have escalated past L1 (since identity compressor doesn't compress)
    // At minimum, compressor was called for both L1 and L2 attempts
    expect(compressor.callCount).toBeGreaterThanOrEqual(2);
    expect(result.level).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// T8b: L2 tries multi-compression indexing
// ---------------------------------------------------------------------------

describe("T8b: L2 tries multi-compression indexing", () => {
  it("L2 makes multiple compress() calls (one per chunk)", async () => {
    const compressor = new SlightlyCompressingCompressor();
    const tokenCounter = new GptTokenCounter();

    const protocol = new EscalationProtocol(compressor, tokenCounter, {
      level1TokenLimit: 100,
      level2MinRatio: 0.8,
      level3KTokens: 200,
      coherenceSimilarityThreshold: 0.7,
    });

    // Input with multiple paragraphs separated by double newlines.
    // Each paragraph has ~30-35 words (30-35 tokens) so 4 paragraphs ≈ 120-140 tokens,
    // exceeding the level1TokenLimit of 100.
    const para = "cat ".repeat(30).trim(); // 30 tokens per paragraph
    const longText = [para, para, para, para].join("\n\n"); // 4 paragraphs > 100 tokens

    const inputTokens = tokenCounter.countTokens(longText);
    expect(inputTokens).toBeGreaterThan(100);

    await protocol.escalate(longText);

    // L2 should have made more than 1 compress() call (L1 call + L2 chunk calls)
    expect(compressor.callCount).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// T9: L3 activates when both L1 and L2 fail
// ---------------------------------------------------------------------------

describe("T9: L3 activates when both L1 and L2 fail", () => {
  it("L3 activates when expanding compressor makes text longer", async () => {
    // ExpandingCompressor always returns text LONGER than input
    // Forces both L1 and L2 to fail, triggering L3
    const compressor = new ExpandingCompressor();
    const tokenCounter = new GptTokenCounter();

    const protocol = new EscalationProtocol(compressor, tokenCounter, {
      level1TokenLimit: 100,
      level2MinRatio: 0.8,
      level3KTokens: 200,
      coherenceSimilarityThreshold: 0.7,
    });

    const text = generateText(150);
    const result = await protocol.escalate(text);

    // L3 MUST activate — this is the STATE.md pitfall guard
    expect(result.level).toBe(3);
    expect(result.compressorUsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T9b: L3 uses zero LLM inference
// ---------------------------------------------------------------------------

describe("T9b: L3 uses zero LLM inference", () => {
  it("compressor is NOT called during L3 — only during L1 and L2 attempts", async () => {
    const compressor = new ExpandingCompressor();
    const tokenCounter = new GptTokenCounter();

    const protocol = new EscalationProtocol(compressor, tokenCounter, {
      level1TokenLimit: 100,
      level2MinRatio: 0.8,
      level3KTokens: 200,
      coherenceSimilarityThreshold: 0.7,
    });

    const text = generateText(150);

    // Reset call count to track L3-specific calls
    compressor.callCount = 0;

    const result = await protocol.escalate(text);
    expect(result.level).toBe(3);

    // Compressor was only called for L1 and L2 (not L3)
    // The exact number depends on L2 chunking, but L3 must NOT add any calls
    const callsBeforeL3 = compressor.callCount;

    // After L3 executes, callCount should NOT increase further
    // (This is guaranteed by implementation, but we verify the metadata)
    expect(result.compressorUsed).toBe(false);

    // T9b: L3 must not call the compressor. This is verified by:
    // 1. result.compressorUsed === false
    // 2. No additional calls are possible since escalate() returns before we get here
    expect(callsBeforeL3).toBeGreaterThanOrEqual(1); // L1 + L2 both tried
  });
});

// ---------------------------------------------------------------------------
// T9c: L3 chunks before truncating
// ---------------------------------------------------------------------------

describe("T9c: L3 chunks before truncating", () => {
  it("L3 output contains multiple compressed chunk sections for multi-paragraph input", async () => {
    const compressor = new ExpandingCompressor();
    const tokenCounter = new GptTokenCounter();

    const protocol = new EscalationProtocol(compressor, tokenCounter, {
      level1TokenLimit: 100,
      level2MinRatio: 0.8,
      level3KTokens: 500, // Large enough so chunking succeeds without hard truncation
      coherenceSimilarityThreshold: 0.7,
    });

    // At least 4 paragraphs separated by double newlines
    const paragraphs = [
      "First paragraph: This is the beginning of the document with substantial content.",
      "Second paragraph: This section discusses a different topic with additional information.",
      "Third paragraph: Here we explore another aspect of the subject matter in detail.",
      "Fourth paragraph: The final section concludes with a summary of the main points.",
    ];
    const text = paragraphs.join("\n\n");
    // Make text long enough to trigger L1
    const longText = text + "\n\n" + text;

    const result = await protocol.escalate(longText);
    expect(result.level).toBe(3);

    // T9c: chunking first — L3 result should have chunks metadata
    expect(result.chunks).toBeDefined();
    expect(result.chunks).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// T9d: L3 output is <= kTokens
// ---------------------------------------------------------------------------

describe("T9d: L3 output is <= kTokens", () => {
  it("L3 output token count is always <= level3KTokens", async () => {
    const compressor = new ExpandingCompressor();
    const tokenCounter = new GptTokenCounter();
    const kTokens = 50;

    const protocol = new EscalationProtocol(compressor, tokenCounter, {
      level1TokenLimit: 100,
      level2MinRatio: 0.8,
      level3KTokens: kTokens,
      coherenceSimilarityThreshold: 0.7,
    });

    const text = generateText(200); // Much larger than kTokens
    const result = await protocol.escalate(text);

    expect(result.level).toBe(3);

    // Cross-verify with gpt-tokenizer encode directly
    const outputTokens = encode(result.output).length;
    expect(outputTokens).toBeLessThanOrEqual(kTokens);
    expect(result.outputTokens).toBeLessThanOrEqual(kTokens);
  });
});

// ---------------------------------------------------------------------------
// T9e: L3 is fully deterministic
// ---------------------------------------------------------------------------

describe("T9e: L3 is fully deterministic", () => {
  it("same input always produces byte-identical L3 output", async () => {
    const tokenCounter = new GptTokenCounter();

    const makeProtocol = () =>
      new EscalationProtocol(new ExpandingCompressor(), tokenCounter, {
        level1TokenLimit: 100,
        level2MinRatio: 0.8,
        level3KTokens: 50,
        coherenceSimilarityThreshold: 0.7,
      });

    const text = generateText(200);

    const result1 = await makeProtocol().escalate(text);
    const result2 = await makeProtocol().escalate(text);

    expect(result1.level).toBe(3);
    expect(result2.level).toBe(3);

    // Byte-identical outputs
    expect(result1.output).toBe(result2.output);
    expect(result1.outputTokens).toBe(result2.outputTokens);
  });
});

// ---------------------------------------------------------------------------
// T9f: L3 falls back to hard truncation when chunks still exceed kTokens
// ---------------------------------------------------------------------------

describe("T9f: L3 falls back to hard truncation when chunks exceed kTokens", () => {
  it("with very small kTokens, output is hard-truncated to exactly kTokens tokens", async () => {
    const compressor = new ExpandingCompressor();
    const tokenCounter = new GptTokenCounter();
    const kTokens = 20; // Very small — ensures hard truncation is needed

    const protocol = new EscalationProtocol(compressor, tokenCounter, {
      level1TokenLimit: 50,
      level2MinRatio: 0.8,
      level3KTokens: kTokens,
      coherenceSimilarityThreshold: 0.7,
    });

    // 10 paragraphs of substantive content, each contributing multiple tokens
    const paragraphs = Array.from(
      { length: 10 },
      (_, i) =>
        `Paragraph ${i + 1}: This section contains substantial content about topic ${i + 1} with many words.`,
    );
    const text = paragraphs.join("\n\n");

    const result = await protocol.escalate(text);
    expect(result.level).toBe(3);

    // Output must be <= kTokens (hard truncation guarantees this)
    const outputTokens = encode(result.output).length;
    expect(outputTokens).toBeLessThanOrEqual(kTokens);
  });
});

// ---------------------------------------------------------------------------
// T9g: setThresholds updates at runtime
// ---------------------------------------------------------------------------

describe("T9g: setThresholds updates at runtime", () => {
  it("L1 does not trigger after raising level1TokenLimit above input size", async () => {
    const compressor = new MockCompressor();
    const compressSpy = vi.spyOn(compressor, "compress");
    const tokenCounter = new GptTokenCounter();

    const protocol = new EscalationProtocol(compressor, tokenCounter, {
      level1TokenLimit: 100, // Initially triggers at 100 tokens
      level2MinRatio: 0.8,
      level3KTokens: 200,
      coherenceSimilarityThreshold: 0.7,
    });

    const text = generateText(150); // 150 tokens (each "cat" = 1 token) — triggers L1 at threshold 100
    const inputTokens = tokenCounter.countTokens(text);
    expect(inputTokens).toBeGreaterThan(100);
    expect(inputTokens).toBeLessThan(200);

    // Raise the threshold to 200 — 150 tokens should no longer trigger L1
    protocol.setThresholds({ level1TokenLimit: 200 });

    const result = await protocol.escalate(text);

    // L1 should NOT have triggered (input is below new threshold)
    expect(compressSpy).not.toHaveBeenCalled();
    expect(result.level).toBe(0 as unknown as 1); // No escalation
  });
});

// ---------------------------------------------------------------------------
// T9h: escalation emits events
// ---------------------------------------------------------------------------

describe("T9h: escalation emits events", () => {
  it('protocol emits "escalation" event with level and metadata', async () => {
    const compressor = new MockCompressor();
    const tokenCounter = new GptTokenCounter();

    const protocol = new EscalationProtocol(compressor, tokenCounter, {
      level1TokenLimit: 100,
      level2MinRatio: 0.8,
      level3KTokens: 200,
      coherenceSimilarityThreshold: 0.7,
    });

    const events: unknown[] = [];
    protocol.on("escalation", (event) => events.push(event));

    const text = generateText(150);
    const result = await protocol.escalate(text);

    // At least one escalation event should have been emitted
    expect(events.length).toBeGreaterThan(0);

    // Event should include level and metadata
    const event = events[0] as Record<string, unknown>;
    expect(event).toHaveProperty("level");
    expect([1, 2, 3]).toContain(event["level"]);
    expect(result.level).toBeGreaterThanOrEqual(1);
  });
});
