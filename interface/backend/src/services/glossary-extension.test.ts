/**
 * The vocabulary extends itself, once, under validation.
 *
 * Before this, pass one generated 43 labels unsupervised and they were
 * auto-accepted, while pass two's grounded requests — each carrying a claim
 * that needed it and a segment to ground it — required a person to hand-author
 * ontology. Every new subject therefore needed a bespoke glossary before AGEM
 * could reason about it. These tests pin the guards that make the extension
 * safe, not the fact that it happens.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClosedGlossaryEntry } from "./claim-extractor.js";

const chat = vi.fn();
vi.mock("./llm.js", () => ({
  getActiveProvider: () => ({ chat }),
}));

const { extendClosedGlossary, buildGlossaryExtensionPrompt } = await import(
  "./claim-extractor.js"
);

const EXISTING: ClosedGlossaryEntry[] = [
  {
    label: "observer-independence",
    kind: "property",
    definition: "facts hold independently of any observer",
    sourceForms: ["observer independence"],
  },
];

const NEED = [
  {
    segmentId: "s1",
    text: "Consistent Histories attaches probabilities to whole histories relative to a framework.",
    reason: "no closed label represents framework-relative probability",
    candidateLabels: ["framework-relativity"],
  },
];

function respond(glossary: unknown[]) {
  chat.mockResolvedValue({
    content: JSON.stringify({ glossary }),
    finishReason: "stop",
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

beforeEach(() => chat.mockReset());

describe("what the extension accepts", () => {
  it("adds a source-grounded label the corpus actually uses", async () => {
    respond([
      {
        label: "framework-relativity",
        kind: "property",
        definition: "probabilities are stated relative to a chosen framework",
        sourceForms: ["relative to a framework"],
      },
    ]);
    const { additions, rejected } = await extendClosedGlossary(NEED, EXISTING);
    expect(additions.map((a) => a.label)).toEqual(["framework-relativity"]);
    expect(rejected).toEqual([]);
  });

  it("does nothing at all when there are no gaps", async () => {
    const result = await extendClosedGlossary([], EXISTING);
    expect(result.additions).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });
});

describe("what the extension refuses", () => {
  it("refuses to redefine an existing label", async () => {
    // A redefinition silently changes what every already-accepted claim means.
    respond([
      {
        label: "observer-independence",
        kind: "property",
        definition: "something subtly different",
        sourceForms: ["observer independence"],
      },
    ]);
    const { additions, rejected } = await extendClosedGlossary(NEED, EXISTING);
    expect(additions).toEqual([]);
    expect(rejected[0]!.why).toMatch(/only add, never redefine/);
  });

  it("refuses a label the corpus never uses", async () => {
    // The guard against inventing vocabulary: if no surface form appears in
    // the segment that asked for it, the label is the model's, not the text's.
    respond([
      {
        label: "quantum-teleportation",
        kind: "property",
        definition: "a concept from somewhere else entirely",
        sourceForms: ["teleportation protocol"],
      },
    ]);
    const { additions, rejected } = await extendClosedGlossary(NEED, EXISTING);
    expect(additions).toEqual([]);
    expect(rejected[0]!.why).toMatch(/no surface form of this label appears/);
  });

  it("refuses a label the audited ontology maps elsewhere", async () => {
    respond([
      {
        label: "framework-relativity",
        kind: "property",
        definition: "probabilities relative to a framework",
        sourceForms: ["relative to a framework"],
      },
    ]);
    const { additions, rejected } = await extendClosedGlossary(NEED, EXISTING, {
      "framework-relativity": "observer-independence",
    });
    expect(additions).toEqual([]);
    expect(rejected[0]!.why).toMatch(/audited ontology maps this label/);
  });

  it("adds nothing when the extension pass returns unusable output", async () => {
    chat.mockResolvedValue({
      content: "I cannot extend this glossary.",
      finishReason: "stop",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const { additions } = await extendClosedGlossary(NEED, EXISTING);
    expect(additions).toEqual([]);
  });

  it("adds nothing when the extension pass truncates", async () => {
    chat.mockResolvedValue({
      content: JSON.stringify({ glossary: [] }),
      finishReason: "length",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const { additions } = await extendClosedGlossary(NEED, EXISTING);
    expect(additions).toEqual([]);
  });
});

describe("the extension prompt", () => {
  const prompt = () => buildGlossaryExtensionPrompt(NEED, EXISTING);

  it("shows the existing vocabulary and forbids repeating it", () => {
    expect(prompt()).toMatch(/EXISTING VOCABULARY \(do not redefine, do not repeat\)/);
    expect(prompt()).toMatch(/observer-independence/);
    expect(prompt()).toMatch(/ADD ONLY/);
  });

  it("passes the source text and the extractor's own reason", () => {
    expect(prompt()).toMatch(/relative to a framework/);
    expect(prompt()).toMatch(/no closed label represents framework-relative probability/);
    expect(prompt()).toMatch(/EXTRACTOR SUGGESTED: framework-relativity/);
  });

  it("tells it to mint both poles rather than a one-sided axis", () => {
    // The ["collapse","collapse"] failure: a signed-property axis cannot carry
    // a two-way distinction.
    expect(prompt()).toMatch(/mint BOTH poles as axis-values/);
  });

  it("permits an honest gap over a fabricated label", () => {
    expect(prompt()).toMatch(/An honest gap is a finding; a fabricated label is not/);
  });
});
