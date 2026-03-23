/**
 * index.ts
 *
 * Public barrel export for the entire TNA (Text Network Analysis) module.
 *
 * This is the single entry point for external modules (primarily the
 * Orchestrator in Phase 5) to use TNA functionality. All types and classes
 * are re-exported here with full TypeScript support.
 *
 * Architecture invariant: Only the orchestrator imports from src/tna/.
 * All other modules (sheaf, lcm, soc) are independent and do not reference TNA.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  TextNodeId,
  TextNode,
  TextEdge,
  GapMetrics,
  CommunityAssignment,
  TNAConfig,
  PreprocessResult,
  DetailedPreprocessResult,
} from "./interfaces.js";

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export { Preprocessor } from "./Preprocessor.js";
export { CooccurrenceGraph } from "./CooccurrenceGraph.js";
export { LouvainDetector } from "./LouvainDetector.js";
export { CentralityAnalyzer } from "./CentralityAnalyzer.js";
export { GapDetector } from "./GapDetector.js";

// Phase 6: Catalyst question generation (TNA-07)
export { CatalystQuestionGenerator } from "./CatalystQuestionGenerator.js";

// Phase 6: Layout computation (TNA-08)
export { LayoutComputer } from "./LayoutComputer.js";

// Phase 7: Community summarization
export { CommunitySummarizer } from "./CommunitySummarizer.js";
export type {
  ConceptCommunity,
  ConceptEdge,
  ConceptGraph,
} from "./CommunitySummarizer.js";

// Phase 6: Extended types (TNA-07, TNA-08, TNA-09)
export type {
  CatalystQuestion,
  CentralityTimeSeries,
  CentralityTrend,
  CentralityTimeSeriesConfig,
  NodePosition,
  LayoutConfig,
  LayoutOutput,
  LayoutExportJSON,
  LayoutComputerConfig,
} from "./interfaces.js";
