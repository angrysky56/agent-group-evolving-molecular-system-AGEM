/**
 * ComposeRootModule.ts
 *
 * ORCH-05: Orchestrator composition root — the sole module that imports from
 * src/sheaf, src/lcm, src/tna, and src/soc simultaneously.
 *
 * Purpose: Instantiate all four subsystem modules with shared dependencies,
 * wire their event emissions through the central EventBus, add obstruction-driven
 * reconfiguration via ObstructionHandler, and expose runReasoning() as the full
 * pipeline entry point.
 *
 * Architecture invariant: This is the ONLY file in the repository that imports
 * from multiple Phase 1-4 modules. Module isolation is statically verified by
 * src/orchestrator/isolation.test.ts.
 *
 * Imports (by module):
 *   sheaf: CellularSheaf, CohomologyAnalyzer
 *   lcm:   LCMClient, ImmutableStore, EmbeddingCache, IEmbedder
 *   tna:   Preprocessor, CooccurrenceGraph, LouvainDetector, CentralityAnalyzer, GapDetector
 *   soc:   SOCTracker, SOCInputs
 *   orch:  EventBus, OrchestratorState, OrchestratorStateManager, ObstructionHandler
 */
import { CellularSheaf, CohomologyAnalyzer } from "../sheaf/index.js";
import { LCMClient } from "../lcm/index.js";
import type { IEmbedder, SummaryNode, LCMEntry, EscalationLevel } from "../lcm/index.js";
import { LumpabilityAuditor } from "../lumpability/index.js";
import { PriceEvolver } from "../evolution/index.js";
import { Preprocessor, CooccurrenceGraph, LouvainDetector, CentralityAnalyzer, GapDetector, CatalystQuestionGenerator, LayoutComputer } from "../tna/index.js";
import { SOCTracker } from "../soc/index.js";
import { EventBus } from "./EventBus.js";
import { OrchestratorState, OrchestratorStateManager } from "./OrchestratorState.js";
import { ObstructionHandler } from "./ObstructionHandler.js";
/**
 * Orchestrator — composition root for the AGEM system.
 *
 * Wires all four AGEM modules (Sheaf, LCM, TNA, SOC) under a single coordinator.
 * Manages the full reasoning pipeline, routes all events through the central
 * EventBus, and responds to topological obstructions by spawning gapDetector
 * agents to fill semantic voids.
 *
 * Usage:
 *   const embedder: IEmbedder = new MyEmbedder();
 *   const orchestrator = new Orchestrator(embedder);
 *   await orchestrator.runReasoning('What is the relationship between X and Y?');
 *   console.log('Iteration count:', orchestrator.getIterationCount());
 *   console.log('State:', orchestrator.getState());
 *   await orchestrator.shutdown();
 *
 * Lifecycle:
 *   1. Constructor: instantiate all 11 components, wire events
 *   2. runReasoning(prompt): execute full pipeline per iteration
 *   3. shutdown(): placeholder for resource cleanup (Phase 6+)
 */
export declare class Orchestrator {
    #private;
    /** Central event bus: all module events route through this coordinator. */
    readonly eventBus: EventBus;
    /** Sheaf data structure: tracks agent stalk sections and restriction maps. */
    readonly sheaf: CellularSheaf;
    /** Cohomology analyzer: computes H^0/H^1 from sheaf and emits obstruction events. */
    readonly cohomologyAnalyzer: CohomologyAnalyzer;
    /** LCM client: append-only context store with embedding caching. */
    readonly lcmClient: LCMClient;
    /** TNA text preprocessor: lemmatization + TF-IDF pipeline. */
    readonly tnaPreprocessor: Preprocessor;
    /** TNA co-occurrence graph: 4-gram weighted semantic network. */
    readonly tnaGraph: CooccurrenceGraph;
    /** TNA Louvain community detector: deterministic community partitioning. */
    readonly tnaLouvain: LouvainDetector;
    /** TNA centrality analyzer: betweenness centrality for bridge node identification. */
    readonly tnaCentrality: CentralityAnalyzer;
    /** TNA gap detector: structural gap detection with topological metrics. */
    readonly tnaGapDetector: GapDetector;
    /** TNA catalyst question generator: gap-targeted question generation (Phase 6, TNA-07). */
    readonly tnaCatalystGenerator: CatalystQuestionGenerator;
    /** TNA layout computer: ForceAtlas2 visualization layout for semantic graph (Phase 6, TNA-08). */
    readonly tnaLayout: LayoutComputer;
    /** SOC tracker: computes all five SOC metrics and detects phase transitions. */
    readonly socTracker: SOCTracker;
    /** State manager: tracks NORMAL/OBSTRUCTED/CRITICAL operational modes. */
    readonly stateManager: OrchestratorStateManager;
    /** Obstruction handler: H^1 detection → gapDetector agent spawn pipeline. */
    readonly obstructionHandler: ObstructionHandler;
    /** Lumpability auditor: detects information loss at LCM compaction boundaries. */
    readonly lumpabilityAuditor: LumpabilityAuditor;
    /** Price evolver: evolutionary feedback via the Price equation on TNA graph edges. */
    readonly priceEvolver: PriceEvolver;
    /**
     * Create an Orchestrator instance wiring all four AGEM modules.
     *
     * @param embedder - IEmbedder implementation injected for LCM embedding cache.
     *                   Must implement embed(text: string): Promise<Float64Array>.
     *                   MockEmbedder from src/lcm/interfaces.ts can be used in tests.
     */
    constructor(embedder: IEmbedder);
    /**
     * runReasoning — execute the full AGEM reasoning pipeline for one iteration.
     *
     * Pipeline:
     *   1. Increment iteration counter
     *   2. Preprocess text via TNA
     *   3. Build co-occurrence graph
     *   4. Run Louvain community detection
     *   5. Append prompt to LCM
     *   6. Run Sheaf cohomology analysis (emits consensus or obstruction events)
     *   7. Compute SOC metrics (emits soc:metrics and optionally phase:transition)
     *
     * Events emitted:
     *   - 'sheaf:consensus-reached' or 'sheaf:h1-obstruction-detected'
     *   - 'soc:metrics'
     *   - Optionally: 'phase:transition', 'orch:state-changed', 'orch:obstruction-filled'
     *
     * @param prompt - Text input for this reasoning iteration.
     */
    runReasoning(prompt: string): Promise<void>;
    /**
     * shutdown — graceful teardown of the Orchestrator.
     *
     * For Phase 5: placeholder for future resource cleanup (Phase 6+).
     * Future enhancements: drain EventBus, terminate AgentPool, flush LCM.
     */
    shutdown(): Promise<void>;
    /**
     * getIterationCount — returns the number of runReasoning() calls made.
     */
    getIterationCount(): number;
    /**
     * getState — returns the current operational state (NORMAL/OBSTRUCTED/CRITICAL).
     */
    getState(): OrchestratorState;
    /**
     * auditCompaction — trigger a lumpability audit on a compaction result.
     *
     * Called when ContextDAG creates a SummaryNode via EscalationProtocol.
     * Compares embedding entropy of the source entries against the summary
     * to detect information loss (weak lumpability).
     *
     * Events emitted via EventBus:
     *   - 'lumpability:audit-complete' (every audit)
     *   - 'lumpability:weak-compression' (only when classification = 'weak')
     *
     * In Phase 5: available for explicit invocation.
     * In Phase 6+: auto-triggered when the LCM engine compacts context.
     *
     * @param summaryNode    - The SummaryNode produced by compaction.
     * @param sourceEntries  - The original LCMEntries that were compacted.
     * @param escalationLevel - Which level produced this summary (1, 2, or 3).
     */
    auditCompaction(summaryNode: SummaryNode, sourceEntries: readonly LCMEntry[], escalationLevel: EscalationLevel): Promise<void>;
}
//# sourceMappingURL=ComposeRootModule.d.ts.map