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
export type { SOCInputs, SOCMetrics, SOCConfig, MetricsTrend, } from "./interfaces.js";
export { vonNeumannEntropy, embeddingEntropy, cosineSimilarity, } from "./entropy.js";
export { pearsonCorrelation, linearSlope } from "./correlation.js";
export { SOCTracker } from "./SOCTracker.js";
export { RegimeValidator, RegimeAnalyzer } from "./RegimeValidator.js";
export type { RegimeStability, RegimeMetrics, RegimeValidatorConfig, RegimeAnalyzerConfig, } from "./interfaces.js";
//# sourceMappingURL=index.d.ts.map