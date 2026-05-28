/**
 * src/lcm/index.ts
 *
 * Public barrel export for the LCM (Lossless Context Management) module.
 * All other modules import from this file exclusively.
 *
 * Note: .js extensions required for NodeNext module resolution.
 */

// Types and interfaces
export {
  type LCMEntry,
  type IEmbedder,
  type ICompressor,
  type ITokenCounter,
  type EscalationThresholds,
  type EscalationLevel,
  type ExpandLevel,
  type SummaryNode,
  type MetricUpdate,
  EMBEDDING_DIM,
  GptTokenCounter,
  MockEmbedder,
  MockCompressor,
} from "./interfaces.js";

// Core store and client
export { ImmutableStore } from "./ImmutableStore.js";
export { LCMClient } from "./LCMClient.js";

// DAG and summary management
export { ContextDAG } from "./ContextDAG.js";
export { SummaryIndex } from "./SummaryIndex.js";
export { SubgraphRegistry } from "./SubgraphRegistry.js";
export type {
  Subgraph,
  SubgraphSnapshot,
  SubgraphRegistrySnapshot,
} from "./SubgraphRegistry.js";

// Escalation
export { EscalationProtocol } from "./EscalationProtocol.js";
export {
  deterministicTruncate,
  deterministicChunkCompress,
} from "./EscalationProtocol.js";
export type { EscalationResult } from "./EscalationProtocol.js";

// Search and retrieval
export { LCMGrep } from "./LCMGrep.js";
export { EmbeddingCache } from "./EmbeddingCache.js";
export { lcm_expand } from "./LCMExpand.js";
