/**
 * src/lcm/index.ts
 *
 * Public barrel export for the LCM (Lossless Context Management) module.
 * All other modules import from this file exclusively.
 *
 * Note: .js extensions required for NodeNext module resolution.
 */
export { type LCMEntry, type IEmbedder, type ICompressor, type ITokenCounter, type EscalationThresholds, type EscalationLevel, type ExpandLevel, type SummaryNode, type MetricUpdate, EMBEDDING_DIM, GptTokenCounter, MockEmbedder, MockCompressor, } from "./interfaces.js";
export { ImmutableStore } from "./ImmutableStore.js";
export { LCMClient } from "./LCMClient.js";
export { ContextDAG } from "./ContextDAG.js";
export { SummaryIndex } from "./SummaryIndex.js";
export { EscalationProtocol } from "./EscalationProtocol.js";
export { deterministicTruncate, deterministicChunkCompress, } from "./EscalationProtocol.js";
export type { EscalationResult } from "./EscalationProtocol.js";
export { LCMGrep } from "./LCMGrep.js";
export { EmbeddingCache } from "./EmbeddingCache.js";
export { lcm_expand } from "./LCMExpand.js";
//# sourceMappingURL=index.d.ts.map