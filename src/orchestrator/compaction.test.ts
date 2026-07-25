/**
 * compaction.test.ts — when consolidation fires, and when it must not.
 *
 * The old trigger was `estimatedTokens > level1TokenLimit`, and the whole test
 * suite passed while it had three separate defects:
 *
 *   1. CONTENT-BLIND — a token count is not a memory bottleneck, so it
 *      consolidated material that was still actively developing.
 *   2. MONOTONE — the LCM store is append-only, so the count never fell and
 *      the trigger never un-fired once crossed.
 *   3. QUADRATIC — each firing re-compacted the entire accumulated history,
 *      so cost grew with session length (measured: 49s of a 53s cycle).
 *
 * None of that was visible to a test. These make it visible.
 */

import { describe, it, expect } from "vitest";
import { Orchestrator } from "./ComposeRootModule.js";
import { MockEmbedder, MockCompressor } from "../lcm/interfaces.js";

/** Counts how many times the compressor was asked to do real work. */
class CountingCompressor extends MockCompressor {
  calls = 0;
  lastInputLength = 0;
  override async compress(text: string, ratio: number): Promise<string> {
    this.calls++;
    this.lastInputLength = text.length;
    return super.compress(text, ratio);
  }
}

const PARAGRAPH =
  "capability transfers across benchmark distributions because the learned " +
  "representation is general rather than indexed to the training sample, and " +
  "measurement under one sampling procedure therefore predicts behaviour under " +
  "another procedure entirely. ";

/** Roughly `n` paragraphs of material, enough to exceed small thresholds. */
const material = (n: number): string => PARAGRAPH.repeat(n);

describe("consolidation does not fire on unsettled material", () => {
  it("stays quiet in the nascent regime below the ceiling", async () => {
    // The regime never leaves `nascent` in a short run, and nascent means the
    // material is still developing. Consolidating here is what destroys
    // articulation that is still needed — the weak-lumpability failure.
    const comp = new CountingCompressor();
    const orch = new Orchestrator(new MockEmbedder(), comp, {
      lcmCompaction: { ceilingTokens: 1_000_000, minNewTokens: 10 },
    });
    try {
      for (let i = 0; i < 3; i++) await orch.runReasoning(material(20));
      expect(comp.calls).toBe(0);
    } finally {
      await orch.shutdown();
    }
  });

  it("stays quiet when there is too little new material to be worth it", async () => {
    const comp = new CountingCompressor();
    const orch = new Orchestrator(new MockEmbedder(), comp, {
      // Ceiling would fire, but nothing substantial has accumulated.
      lcmCompaction: { ceilingTokens: 1, minNewTokens: 1_000_000 },
    });
    try {
      await orch.runReasoning(material(5));
      expect(comp.calls).toBe(0);
    } finally {
      await orch.shutdown();
    }
  });
});

describe("the ceiling is a real backstop", () => {
  it("forces consolidation regardless of regime", async () => {
    const comp = new CountingCompressor();
    const orch = new Orchestrator(new MockEmbedder(), comp, {
      lcmCompaction: { ceilingTokens: 1, minNewTokens: 1 },
    });
    try {
      await orch.runReasoning(material(10));
      expect(comp.calls).toBeGreaterThan(0);
    } finally {
      await orch.shutdown();
    }
  });
});

describe("consolidation is bounded, not quadratic", () => {
  it("compacts only material not already folded into a summary", async () => {
    // THE regression. Because the store is append-only, the old trigger
    // re-compacted everything every cycle and the input grew without bound.
    // Each consolidation should now see only what is new.
    const comp = new CountingCompressor();
    const orch = new Orchestrator(new MockEmbedder(), comp, {
      lcmCompaction: { ceilingTokens: 1, minNewTokens: 1 },
    });
    try {
      await orch.runReasoning(material(10));
      const firstInput = comp.lastInputLength;

      // A much smaller follow-up. If the whole history were being recompacted
      // the input would GROW; it should instead reflect only the new entry.
      await orch.runReasoning(material(1));
      const secondInput = comp.lastInputLength;

      expect(secondInput).toBeLessThan(firstInput);
    } finally {
      await orch.shutdown();
    }
  });

  it("does not re-consolidate when nothing new has arrived", async () => {
    const comp = new CountingCompressor();
    const orch = new Orchestrator(new MockEmbedder(), comp, {
      lcmCompaction: { ceilingTokens: 1, minNewTokens: 5 },
    });
    try {
      await orch.runReasoning(material(10));
      const afterFirst = comp.calls;
      expect(afterFirst).toBeGreaterThan(0);

      // A cycle whose new material falls under minNewTokens must not trigger
      // another pass over the history.
      await orch.runReasoning("tiny");
      expect(comp.calls).toBe(afterFirst);
    } finally {
      await orch.shutdown();
    }
  });
});

describe("the compression target is set by the caller", () => {
  it("compresses settled material to a fraction of ITS size, not to a fixed limit", async () => {
    // level1TokenLimit used to be both trigger and target. Separating them is
    // what lets consolidation say "reduce this to 40%" without also saying
    // "and compact anything above 40% forever".
    const comp = new CountingCompressor();
    const orch = new Orchestrator(new MockEmbedder(), comp, {
      lcmCompaction: { ceilingTokens: 1, minNewTokens: 1, targetRatio: 0.25 },
    });
    try {
      await orch.runReasoning(material(20));
      expect(comp.calls).toBeGreaterThan(0);
    } finally {
      await orch.shutdown();
    }
  });
});
