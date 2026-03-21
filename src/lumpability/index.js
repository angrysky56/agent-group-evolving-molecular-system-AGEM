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
export { DEFAULT_LUMPABILITY_CONFIG } from "./interfaces.js";
// Entropy profile computation
export { computeEntropyProfile, computeCentroidSimilarity, } from "./entropyProfile.js";
// Core auditor
export { LumpabilityAuditor } from "./LumpabilityAuditor.js";
// MCP bridge for cross-session coordination
export { MCPBridge } from "./MCPBridge.js";
//# sourceMappingURL=index.js.map