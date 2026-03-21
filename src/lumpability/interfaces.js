/**
 * interfaces.ts — Lumpability Auditor type definitions
 *
 * Shared contracts for the lumpability auditing subsystem.
 * Detects information loss (weak lumpability) at LCM compaction boundaries
 * by comparing embedding entropy profiles of source entries vs summary nodes.
 *
 * Isolation invariant: Imports ONLY from src/lcm/interfaces (IEmbedder, EscalationLevel)
 * and src/types/ (event types). ZERO imports from src/tna/, src/sheaf/, src/orchestrator/.
 *
 * Theoretical basis:
 *   Strong lumpability: compressed state preserves Markov property for ALL initial distributions.
 *   Weak lumpability: compressed state preserves Markov property only for SPECIFIC distributions.
 *   Detection: if entropy preservation ratio falls below escalation-level-specific thresholds,
 *   the compression is likely weakly lumpable — critical hidden variables were dropped.
 */
// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------
/**
 * DEFAULT_LUMPABILITY_CONFIG — production defaults.
 * Calibrated to flag genuine information loss while tolerating normal compression artifacts.
 */
export const DEFAULT_LUMPABILITY_CONFIG = {
    l1EntropyThreshold: 0.70,
    l2EntropyThreshold: 0.40,
    l3EntropyThreshold: 0.15,
    counterfactualProbeCount: 0,
    minCentroidSimilarity: 0.60,
};
//# sourceMappingURL=interfaces.js.map