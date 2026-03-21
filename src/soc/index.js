/**
 * index.ts — Public barrel export for the SOC module (Phase 4)
 *
 * This is the ONLY file that Phase 5 (Orchestrator) should import from
 * when consuming SOC metrics. All other SOC internals are implementation details.
 *
 * Architecture:
 *   - Types: SOCInputs, SOCMetrics, SOCConfig, MetricsTrend from interfaces.ts
 *   - Pure functions: vonNeumannEntropy, embeddingEntropy, cosineSimilarity from entropy.ts
 *   - Pure functions: pearsonCorrelation, linearSlope from correlation.ts
 *   - Main class: SOCTracker (EventEmitter) from SOCTracker.ts
 *
 * Usage in Phase 5:
 *   import { SOCTracker } from '../soc/index.js';
 *   const tracker = new SOCTracker({ correlationWindowSize: 10 });
 *   tracker.on('soc:metrics', (event) => orchestrator.handleSOCMetrics(event));
 *   tracker.on('phase:transition', (event) => orchestrator.handlePhaseTransition(event));
 *
 * Isolation invariant: The SOC barrel itself imports only from sibling files.
 * The orchestrator is the boundary where multi-module imports are allowed.
 */
// ---------------------------------------------------------------------------
// Pure functions — entropy computation (SOC-01, SOC-02)
// ---------------------------------------------------------------------------
export { vonNeumannEntropy, embeddingEntropy, cosineSimilarity, } from "./entropy.js";
// ---------------------------------------------------------------------------
// Pure functions — correlation utilities (SOC-03, SOC-05)
// ---------------------------------------------------------------------------
export { pearsonCorrelation, linearSlope } from "./correlation.js";
// ---------------------------------------------------------------------------
// Main class — SOCTracker (SOC-03, SOC-04, SOC-05, SOC-06, SOC-07)
// ---------------------------------------------------------------------------
export { SOCTracker } from "./SOCTracker.js";
// ---------------------------------------------------------------------------
// Phase 6: Regime validation and stability analysis (SOC-06, SOC-07)
// ---------------------------------------------------------------------------
export { RegimeValidator, RegimeAnalyzer } from "./RegimeValidator.js";
//# sourceMappingURL=index.js.map