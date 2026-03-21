/**
 * interfaces.ts — SOC domain type definitions
 *
 * Defines the typed contracts for all SOC metric inputs and outputs.
 *
 * Isolation invariant: ZERO imports from src/tna/, src/lcm/, or src/orchestrator/.
 * SOCInputs uses plain TypeScript types (number, ReadonlyMap, ReadonlyArray),
 * NOT TNA class instances. This decouples SOC from TNA runtime classes so that
 * SOCTracker can be tested with synthetic inputs and integrated into Phase 5
 * without circular dependencies.
 *
 * The SOCMetrics structure mirrors the SOCMetricsEvent payload (src/types/Events.ts).
 * SOCTracker constructs a SOCMetrics, then maps it to a SOCMetricsEvent before emitting.
 */
export {};
//# sourceMappingURL=interfaces.js.map