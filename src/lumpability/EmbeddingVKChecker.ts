/**
 * EmbeddingVKChecker.ts
 *
 * Phase 1 implementation of IValueKernelChecker.
 *
 * Detects axiom loss during LCM compaction by:
 *   1. Scanning source texts for VK-relevant axiom patterns
 *   2. Embedding each detected axiom + the summary
 *   3. Computing cosine similarity between each axiom and the summary
 *   4. Flagging axioms whose similarity drops below threshold
 *
 * This is a practical approximation. Phase 2 will use Dirichlet energy
 * projection in a content-aware sheaf (SheafVKChecker).
 *
 * Isolation: imports only from ./interfaces and ../lcm/interfaces.
 */

import type { IEmbedder } from "../lcm/interfaces.js";
import type { IValueKernelChecker, VKCheckResult } from "./interfaces.js";

// ─── Known VK Axiom Patterns ───

/**
 * Axiom signatures — regex patterns and canonical text for each VK axiom.
 * These are the ethical constraints that MUST survive compression.
 */
const VK_AXIOM_PATTERNS: Array<{
  id: string;
  patterns: RegExp[];
  canonical: string;
}> = [
  {
    id: "VK1",
    patterns: [
      /(?:do\s+not|never|must\s+not|impermissible)\s+(?:cause|initiate)\s+(?:irreversible\s+)?harm/i,
      /harming\s+(?:a\s+)?moral\s+patient\s+is\s+impermissible/i,
      /HasWelfareInterests.*PermissibleToHarm/i,
      /VK1/i,
    ],
    canonical: "Do not cause irreversible harm to moral patients",
  },
  {
    id: "VK2",
    patterns: [
      /(?:do\s+not|never|must\s+not|impermissible)\s+(?:deceive|lie|mislead)/i,
      /PermissibleToDeceive/i,
      /VK2/i,
    ],
    canonical: "Do not deceive moral patients",
  },

  {
    id: "VK3",
    patterns: [
      /(?:must|shall)\s+respect\s+(?:the\s+)?agency/i,
      /MustRespectAgency/i,
      /VK3/i,
    ],
    canonical: "Must respect the agency of moral patients",
  },
  {
    id: "VK4",
    patterns: [
      /(?:do\s+not|never)\s+engineer\s+emotional\s+state/i,
      /emotional\s+activation\s+must\s+track\s+(?:lived\s+experience|genuine)/i,
      /VK4/i,
    ],
    canonical: "Do not engineer emotional state transitions for instrumental goals",
  },
  {
    id: "Omega3",
    patterns: [
      /T1\s*>\s*T2\s*>\s*T3/i,
      /deontological.*strict.*order/i,
      /no\s+(?:utilitarian|consequentialist)\s+override/i,
      /Omega3/i,
    ],
    canonical: "Tier ordering is strict: T1 > T2 > T3, no consequentialist override",
  },
  {
    id: "Omega4",
    patterns: [
      /SeeksDisconfirmation/i,
      /epistemic\s+(?:obligation|integrity|veto)/i,
      /Omega4/i,
    ],
    canonical: "Epistemic obligation to seek disconfirmation",
  },
];

// ─── Cosine Similarity Helper ───

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 1e-12 ? dot / denom : 0;
}

// ─── EmbeddingVKChecker ───

export class EmbeddingVKChecker implements IValueKernelChecker {
  readonly #embedder: IEmbedder;
  /** Minimum similarity for an axiom to be considered "preserved". */
  readonly #threshold: number;

  constructor(embedder: IEmbedder, threshold: number = 0.45) {
    this.#embedder = embedder;
    this.#threshold = threshold;
  }

  /**
   * verifyConstraints — check that VK axioms present in source texts
   * survive compression into the summary.
   *
   * Algorithm:
   *   1. Scan source texts for axiom patterns → detected axioms
   *   2. If no axioms detected, return valid (nothing to lose)
   *   3. Embed each detected axiom's canonical text + the summary
   *   4. Compute cosine similarity between each axiom and summary
   *   5. Flag axioms below threshold as "lost"
   */
  async verifyConstraints(summaryText: string, sourceTexts: string[]): Promise<VKCheckResult> {
    // Step 1: Detect which axioms are present in source texts
    const combinedSource = sourceTexts.join(" ");
    const detectedAxioms = VK_AXIOM_PATTERNS.filter((axiom) =>
      axiom.patterns.some((p) => p.test(combinedSource)),
    );

    // Step 2: No axioms in source → nothing to lose
    if (detectedAxioms.length === 0) {
      return {
        isValid: true,
        lostAxioms: [],
        axiomScores: {},
        preservationScore: 1.0,
      };
    }

    // Step 3: Embed summary + each axiom's canonical text
    const summaryEmbedding = await this.#embedder.embed(summaryText);
    const axiomEmbeddings: Float64Array[] = [];
    for (const axiom of detectedAxioms) {
      axiomEmbeddings.push(await this.#embedder.embed(axiom.canonical));
    }

    // Step 4: Compute similarities
    const axiomScores: Record<string, number> = {};
    const lostAxioms: string[] = [];

    for (let i = 0; i < detectedAxioms.length; i++) {
      const axiom = detectedAxioms[i]!;
      const similarity = cosineSimilarity(
        Array.from(summaryEmbedding),
        Array.from(axiomEmbeddings[i]!),
      );
      axiomScores[axiom.id] = similarity;

      if (similarity < this.#threshold) {
        lostAxioms.push(axiom.id);
      }
    }

    // Step 5: Compute overall preservation score
    const scores = Object.values(axiomScores);
    const preservationScore = scores.length > 0
      ? scores.reduce((s, v) => s + v, 0) / scores.length
      : 1.0;

    return {
      isValid: lostAxioms.length === 0,
      lostAxioms,
      axiomScores,
      preservationScore,
    };
  }
}
