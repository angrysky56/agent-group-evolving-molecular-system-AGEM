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
export type { LumpabilityConfig, EntropyProfile, AuditResult, LumpabilityClassification, } from "./interfaces.js";
export { DEFAULT_LUMPABILITY_CONFIG } from "./interfaces.js";
export { computeEntropyProfile, computeCentroidSimilarity, } from "./entropyProfile.js";
export { LumpabilityAuditor } from "./LumpabilityAuditor.js";
export { MCPBridge } from "./MCPBridge.js";
export type { IMCPClient, IMCPToolCall } from "./MCPBridge.js";
//# sourceMappingURL=index.d.ts.map