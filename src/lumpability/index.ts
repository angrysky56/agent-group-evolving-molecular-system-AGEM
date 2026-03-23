/**
 * src/lumpability/index.ts
 *
 * Public barrel export for the Lumpability Auditing module.
 *
 * Detects information loss (weak lumpability) at LCM compaction boundaries
 * by comparing embedding entropy profiles of source entries vs summary nodes.
 *
 * Note: .js extensions required for NodeNext module resolution.
 */

// Types and interfaces
export type {
  LumpabilityConfig,
  EntropyProfile,
  AuditResult,
  LumpabilityClassification,
  IValueKernelChecker,
  VKCheckResult,
} from "./interfaces.js";

export { DEFAULT_LUMPABILITY_CONFIG, AxiomLossError } from "./interfaces.js";

// Entropy profile computation
export {
  computeEntropyProfile,
  computeCentroidSimilarity,
} from "./entropyProfile.js";

// Core auditor
export { LumpabilityAuditor } from "./LumpabilityAuditor.js";

// Value Kernel axiom preservation checker (Phase 1: embedding-based)
export { EmbeddingVKChecker } from "./EmbeddingVKChecker.js";

// MCP bridge for cross-session coordination
export { MCPBridge } from "./MCPBridge.js";
export type { IMCPClient, IMCPToolCall } from "./MCPBridge.js";
