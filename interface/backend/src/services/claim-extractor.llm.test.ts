import { beforeEach, describe, expect, it, vi } from "vitest";

const { chat, storeWrite } = vi.hoisted(() => ({
  chat: vi.fn(),
  storeWrite: vi.fn(),
}));

vi.mock("./llm.js", () => ({
  getActiveProvider: () => ({ chat }),
}));

vi.mock("./typedb-claims.js", () => ({
  claimStore: {
    available: true,
    write: storeWrite,
    status: () => ({ available: true }),
  },
}));

import {
  extractIntoStore,
  proposeClaims,
  proposeClosedGlossary,
} from "./claim-extractor.js";

describe("claim extraction generation profile", () => {
  beforeEach(() => {
    chat.mockReset();
    storeWrite.mockReset();
    storeWrite.mockResolvedValue({});
  });

  it("uses deterministic JSON generation without paid reasoning", async () => {
    chat.mockResolvedValue({
      content: JSON.stringify({ claims: [] }),
      finishReason: "stop",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    await expect(proposeClaims("A sentence.")).resolves.toEqual([]);
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: { enabled: false },
        responseFormat: { type: "json_object" },
        temperature: 0,
      }),
    );
  });

  it("rejects even parseable output when the provider reports truncation", async () => {
    chat.mockResolvedValue({
      content: JSON.stringify({ claims: [] }),
      finishReason: "length",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    await expect(proposeClaims("A sentence.")).resolves.toBeNull();
  });

  it("proposes the closed glossary in a separate whole-corpus pass", async () => {
    chat.mockResolvedValue({
      content: JSON.stringify({
        glossary: [
          {
            label: "dominance",
            kind: "property",
            definition: "the dominance property",
            sourceForms: ["theory holding dominance"],
          },
        ],
      }),
      finishReason: "stop",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    await expect(
      proposeClosedGlossary([
        { id: "s1", text: "A theory holding dominance two-boxes." },
        { id: "s2", text: "That theory is not Newcomb-adequate." },
      ]),
    ).resolves.toEqual([
      {
        label: "dominance",
        kind: "property",
        definition: "the dominance property",
        sourceForms: ["theory holding dominance"],
      },
    ]);
    expect(chat).toHaveBeenCalledTimes(1);
    const prompt = chat.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain(
      "[0] (segmentId=s1) A theory holding dominance two-boxes.",
    );
    expect(prompt).toContain(
      "[1] (segmentId=s2) That theory is not Newcomb-adequate.",
    );
  });

  it("refuses a truncated glossary instead of opening the vocabulary", async () => {
    chat.mockResolvedValue({
      content: JSON.stringify({ glossary: [] }),
      finishReason: "length",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    await expect(
      proposeClosedGlossary([{ id: "s1", text: "A sentence." }]),
    ).resolves.toBeNull();
  });

  it("refuses a glossary that ignores an audited canonical", async () => {
    chat.mockResolvedValue({
      content: JSON.stringify({
        glossary: [
          {
            label: "dominance-principle",
            kind: "property",
            definition: "the dominance property",
            sourceForms: [],
          },
        ],
      }),
      finishReason: "stop",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    await expect(
      proposeClosedGlossary(
        [{ id: "s1", text: "A theory holds the dominance principle." }],
        { "dominance-principle": "dominance" },
      ),
    ).resolves.toBeNull();
  });

  it("stops the pipeline before claim extraction when pass one is invalid", async () => {
    chat.mockResolvedValue({
      content: JSON.stringify({ glossary: [] }),
      finishReason: "length",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const report = await extractIntoStore(
      [{ id: "s1", text: "A theory holds dominance." }],
      "decision-theory",
    );

    expect(report.glossaryFailure).toMatch(/invalid|truncated/i);
    expect(report.telemetry).toMatchObject({
      glossaryCalls: 1,
      batchCalls: 0,
    });
    expect(report.outcomes).toEqual([]);
    expect(storeWrite).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("rejects an escaped symbol and retains an explicit unmappable claim", async () => {
    chat
      .mockResolvedValueOnce({
        content: JSON.stringify({
          glossary: [
            {
              label: "dominance",
              kind: "property",
              definition: "the dominance property",
              sourceForms: ["theory that holds dominance"],
            },
          ],
        }),
        finishReason: "stop",
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          "0": {
            claims: [
              {
                kind: "property-assertion",
                roles: {
                  subject: "theory-that-holds-dominance",
                  property: "dominance",
                },
                scope: "corpus",
                polarity: "asserts",
              },
            ],
            unmappable: [
              { reason: "No glossary entry represents calibration." },
            ],
          },
        }),
        finishReason: "stop",
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });

    const report = await extractIntoStore(
      [{ id: "s1", text: "A theory holding dominance is calibrated." }],
      "decision-theory",
    );

    // Every corpus gets a narrator entity, minted deterministically so the
    // document's own voice has a holder to be attributed to.
    expect(report.glossary.map(({ label }) => label)).toEqual([
      "dominance",
      "corpus-narrator",
    ]);
    expect(report.unmappableClaims).toEqual([
      {
        segmentId: "s1",
        sourceSegmentId: expect.stringMatching(/^source-segment:/),
        reason: "No glossary entry represents calibration.",
      },
    ]);
    expect(report.outcomes).toEqual([
      expect.objectContaining({
        accepted: false,
        rejectionKind: "vocabulary",
        rejection: expect.stringContaining("theory-that-holds-dominance"),
      }),
    ]);
    expect(report.claimsRejected).toBe(1);
    /*
     * An unmappable claim now triggers ONE vocabulary-extension attempt, so
     * the glossary pass is called twice. Here the extension has no mocked
     * response and therefore fails — which is the case worth pinning: a failed
     * extension must leave the first-pass result exactly as it was. The
     * glossary above is still just ["dominance"], the unmappable claim is
     * still reported, and the vocabulary rejection still stands.
     */
    expect(report.telemetry).toMatchObject({
      glossaryCalls: 2,
      batchCalls: 1,
    });
    /*
     * TWO gaps from this one segment, and that is the point: it declares one
     * unmappable claim AND emits a claim using the minted label
     * `theory-that-holds-dominance`. Both say the closed vocabulary cannot
     * express the segment; the extension round now hears both, where it used
     * to hear only the declared one.
     */
    expect(report.glossaryExtension?.requested).toBe(2);
    expect(report.glossaryExtension?.additions).toEqual([]);
    expect(storeWrite).toHaveBeenCalledTimes(1);
  });
});
