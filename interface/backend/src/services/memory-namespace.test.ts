/**
 * AGEM must be able to recall what it established.
 *
 * The namespace is a hard retrieval boundary — "similarity never crosses it
 * unless opted in" — and it defaulted to `session:<uuid>`. Since the CLI and
 * UI mint a session per run, every finding was written where no later run
 * would look. Measured on 2026-07-31: a validated no-contradiction verdict
 * over 17 blocks was stored at 06:39, and the same corpus re-analysed at 20:12
 * recalled nothing (`matches: []`) and derived it from scratch.
 *
 * That is the exact failure `agem-condensed-memory` exists to prevent — "when
 * AGEM re-derives something it already established."
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  identifyCorpus,
  resolveMemoryNamespace,
} from "./glossary-store.js";

const CORPORA = new URL("../../../../corpora/", import.meta.url).pathname;
const read = (p: string) => readFileSync(CORPORA + p, "utf8");

describe("a corpus is recognised by its own heading", () => {
  it.each([
    ["qm-interpretations/corpus.md", "qm-interpretations"],
    ["decision-theory/corpus.md", "decision-theory"],
    ["quantum-mind-genesis/corpus.md", "quantum-mind-genesis"],
    ["reverse-math/corpus.md", "reverse-math"],
  ])("identifies %s", async (file, dir) => {
    expect(await identifyCorpus(read(file))).toBe(dir);
  });

  it("is not fooled by the model's chosen corpus id", async () => {
    /*
     * The same corpus has been called `quantum-mind-genetic-code` and
     * `quantum-mind-genetic-code-synthesis` on different runs. Both are fair
     * descriptions of the material and neither is an identity to key storage
     * on — which is why identification reads the text, not the label.
     */
    const text = read("quantum-mind-genesis/corpus.md");
    expect(await identifyCorpus(text)).toBe("quantum-mind-genesis");
    expect(await identifyCorpus("quantum-mind-genetic-code-synthesis")).toBeNull();
  });
});

describe("what shares a memory, and what does not", () => {
  it("gives two runs of the same corpus the same namespace", async () => {
    const text = read("qm-interpretations/corpus.md");
    const first = await resolveMemoryNamespace(text, "session-aaa");
    const second = await resolveMemoryNamespace(text, "session-bbb");
    expect(first).toBe("corpus:qm-interpretations");
    expect(second).toBe(first);
  });

  it("keeps different corpora apart", async () => {
    expect(
      await resolveMemoryNamespace(read("decision-theory/corpus.md"), "s1"),
    ).not.toBe(
      await resolveMemoryNamespace(read("reverse-math/corpus.md"), "s1"),
    );
  });

  it("keeps a conversation session-scoped", async () => {
    // A chat is not a corpus. The boundary exists for a reason and is widened
    // only where there is a stable subject to widen it to.
    expect(await resolveMemoryNamespace("what did we find yesterday?", "s7")).toBe(
      "session:s7",
    );
    expect(await resolveMemoryNamespace("", "s7")).toBe("session:s7");
  });

  it("gives a pasted document its own continuity via its heading", async () => {
    const doc = "# Interpretations of consciousness and access\n\nSome body text.";
    const ns = await resolveMemoryNamespace(doc, "s1");
    expect(ns).toMatch(/^corpus:interpretations-of-consciousness/);
    expect(await resolveMemoryNamespace(doc, "s2")).toBe(ns);
  });

  it("does not treat a trivial heading as an identity", async () => {
    expect(await resolveMemoryNamespace("# Notes\n\nstuff", "s9")).toBe("session:s9");
  });

  it("always honours an explicit namespace", async () => {
    expect(
      await resolveMemoryNamespace(read("decision-theory/corpus.md"), "s1", "my-scope"),
    ).toBe("my-scope");
  });
});
