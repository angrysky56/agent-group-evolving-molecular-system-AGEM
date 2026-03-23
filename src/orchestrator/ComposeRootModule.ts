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

// ---------------------------------------------------------------------------
// Sheaf module imports
// ---------------------------------------------------------------------------
import {
  CellularSheaf,
  CohomologyAnalyzer,
  buildFlatSheaf,
} from "../sheaf/index.js";

// ---------------------------------------------------------------------------
// LCM module imports
// ---------------------------------------------------------------------------
import {
  LCMClient,
  ImmutableStore,
  EmbeddingCache,
  GptTokenCounter,
} from "../lcm/index.js";
import type { IEmbedder, SummaryNode, LCMEntry, EscalationLevel } from "../lcm/index.js";

// ---------------------------------------------------------------------------
// Lumpability module imports
// ---------------------------------------------------------------------------
import { LumpabilityAuditor, EmbeddingVKChecker } from "../lumpability/index.js";

// ---------------------------------------------------------------------------
// Evolution module imports
// ---------------------------------------------------------------------------
import { PriceEvolver } from "../evolution/index.js";

// ---------------------------------------------------------------------------
// TNA module imports
// ---------------------------------------------------------------------------
import {
  Preprocessor,
  CooccurrenceGraph,
  LouvainDetector,
  CentralityAnalyzer,
  GapDetector,
  CatalystQuestionGenerator,
  LayoutComputer,
  CommunitySummarizer,
} from "../tna/index.js";

// ---------------------------------------------------------------------------
// SOC module imports
// ---------------------------------------------------------------------------
import { SOCTracker } from "../soc/index.js";
import type { SOCInputs } from "../soc/index.js";

// ---------------------------------------------------------------------------
// Orchestrator internal imports
// ---------------------------------------------------------------------------
import { EventBus } from "./EventBus.js";
import {
  OrchestratorState,
  OrchestratorStateManager,
} from "./OrchestratorState.js";
import type { StateChangeEvent } from "./OrchestratorState.js";
import { ObstructionHandler } from "./ObstructionHandler.js";
import { VdWAgentSpawner } from "./VdWAgentSpawner.js";
import type { AnyEvent } from "./interfaces.js";

// ---------------------------------------------------------------------------
// Orchestrator class
// ---------------------------------------------------------------------------

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
export class Orchestrator {
  // -------------------------------------------------------------------------
  // Public readonly properties — all components accessible for testing
  // -------------------------------------------------------------------------

  /** Central event bus: all module events route through this coordinator. */
  readonly eventBus: EventBus;

  /** Sheaf data structure: tracks agent stalk sections and restriction maps. */
  readonly sheaf!: CellularSheaf;

  /** Cohomology analyzer: computes H^0/H^1 from sheaf and emits obstruction events. */
  readonly cohomologyAnalyzer!: CohomologyAnalyzer;

  /** LCM client: append-only context store with embedding caching. */
  readonly lcmClient!: LCMClient;

  /** TNA text preprocessor: lemmatization + TF-IDF pipeline. */
  readonly tnaPreprocessor!: Preprocessor;

  /** TNA co-occurrence graph: 4-gram weighted semantic network. */
  readonly tnaGraph!: CooccurrenceGraph;

  /** TNA Louvain community detector: deterministic community partitioning. */
  readonly tnaLouvain!: LouvainDetector;

  /** TNA centrality analyzer: betweenness centrality for bridge node identification. */
  readonly tnaCentrality!: CentralityAnalyzer;

  /** TNA gap detector: structural gap detection with topological metrics. */
  readonly tnaGapDetector!: GapDetector;

  /** TNA catalyst question generator: gap-targeted question generation (Phase 6, TNA-07). */
  readonly tnaCatalystGenerator!: CatalystQuestionGenerator;

  /** TNA layout computer: ForceAtlas2 visualization layout for semantic graph (Phase 6, TNA-08). */
  readonly tnaLayout!: LayoutComputer;

  /** Community summarizer: aggregates word-level nodes into named concept communities. */
  readonly tnaSummarizer!: CommunitySummarizer;

  /** SOC tracker: computes all five SOC metrics and detects phase transitions. */
  readonly socTracker!: SOCTracker;

  /** State manager: tracks NORMAL/OBSTRUCTED/CRITICAL operational modes. */
  readonly stateManager: OrchestratorStateManager;

  /** Obstruction handler: H^1 detection → gapDetector agent spawn pipeline. */
  readonly obstructionHandler!: ObstructionHandler;

  /** Lumpability auditor: detects information loss at LCM compaction boundaries. */
  readonly lumpabilityAuditor!: LumpabilityAuditor;

  /** Price evolver: evolutionary feedback via the Price equation on TNA graph edges. */
  readonly priceEvolver!: PriceEvolver;

  // -------------------------------------------------------------------------
  // Private fields
  // -------------------------------------------------------------------------

  /** Counter incremented each time runReasoning() is called. */
  #iterationCounter: number = 0;

  /** Previous SOC inputs for reference (unused in Phase 5, ready for Phase 6). */
  #previousSocInputs: SOCInputs | null = null;

  /** Cached node embeddings — persists across iterations, only new nodes are embedded. */
  #nodeEmbeddings: Map<string, Float64Array> = new Map();

  /** Injected embedder reference for node-level embedding computation. */
  #embedder: IEmbedder;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Create an Orchestrator instance wiring all four AGEM modules.
   *
   * @param embedder - IEmbedder implementation injected for LCM embedding cache.
   *                   Must implement embed(text: string): Promise<Float64Array>.
   *                   MockEmbedder from src/lcm/interfaces.ts can be used in tests.
   */
  constructor(embedder: IEmbedder) {
    this.eventBus = new EventBus();
    this.#embedder = embedder;

    this.#initLcm(embedder);
    this.#initSheaf();
    this.#initTna();
    this.#initSoc();
    this.#initLumpability(embedder);
    this.#initEvolution();
    this.stateManager = new OrchestratorStateManager(this.eventBus);
    this.#initOrchestration();

    this.#wireEventBus();
    this.#registerDefaultSubscribers();
  }

  // -------------------------------------------------------------------------
  // Private: event wiring
  // -------------------------------------------------------------------------

  /**
   * Wire CohomologyAnalyzer, SOCTracker, and StateManager events to the central EventBus.
   *
   * CohomologyAnalyzer extends EventEmitter — its events are forwarded via .on() callbacks.
   * SOCTracker extends EventEmitter — same pattern.
   * StateManager emits via EventBus directly (already wired in its constructor).
   */
  #wireEventBus(): void {
    this.#wireCohomologyEvents();
    this.#wireSocEvents();
    this.#wireTnaEvents();
    this.#wireStateEvents();
    this.#wireLumpabilityEvents();
    this.#wireEvolutionEvents();
  }

  #wireCohomologyEvents(): void {
    this.cohomologyAnalyzer.on("sheaf:consensus-reached", (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });

    this.cohomologyAnalyzer.on(
      "sheaf:h1-obstruction-detected",
      (event: AnyEvent) => {
        void this.eventBus.emit(event);

        const h1Dimension =
          (event as { h1Dimension?: number }).h1Dimension ?? 0;
        this.stateManager.updateMetrics(h1Dimension);
        this.obstructionHandler.updateH1ForSpawner(h1Dimension);
      },
    );
  }

  #wireSocEvents(): void {
    this.socTracker.on("soc:metrics", (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });

    this.socTracker.on("phase:transition", (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });

    this.socTracker.on("regime:classification", (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });

    this.eventBus.subscribe("regime:classification", (event: AnyEvent) => {
      const regimeEvent = event as unknown as { regime: string };
      this.obstructionHandler.updateRegime(regimeEvent.regime);
    });

    this.socTracker.on("soc:system1-early-convergence", (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });
  }

  #wireTnaEvents(): void {
    this.tnaCentrality.on(
      "tna:centrality-change-detected",
      (event: AnyEvent) => {
        void this.eventBus.emit(event);
      },
    );
    this.tnaCentrality.on("tna:topology-reorganized", (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });

    this.eventBus.subscribe("regime:classification", (event: AnyEvent) => {
      const regimeEvent = event as unknown as { regime: string };
      this.tnaCentrality.adjustInterval(regimeEvent.regime);
    });

    this.tnaLayout.on("tna:layout-updated", (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });

    this.eventBus.subscribe("regime:classification", (event: AnyEvent) => {
      const regimeEvent = event as unknown as { regime: string };
      this.tnaLayout.adjustInterval(regimeEvent.regime);
    });
  }

  #wireStateEvents(): void {
    this.eventBus.subscribe("orch:state-changed", (event) => {
      const stateEvent = event as unknown as StateChangeEvent;
      console.log(
        `[ORCH] Iteration ${this.#iterationCounter}: State transition to ` +
          `${stateEvent.newState} (reason: ${stateEvent.reason})`,
      );
    });
  }

  /**
   * #wireLumpabilityEvents — forward lumpability auditor events to EventBus.
   *
   * Also subscribes to 'lumpability:weak-compression' for triggering recovery:
   * when weak lumpability is detected, the ObstructionHandler's existing
   * feedback loop can use lcm_expand to re-inject lost context.
   */
  #wireLumpabilityEvents(): void {
    this.lumpabilityAuditor.on("lumpability:audit-complete", (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });

    this.lumpabilityAuditor.on("lumpability:weak-compression", (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });

    // VK axiom loss — critical event. Forward to EventBus for logging
    // and ObstructionHandler recovery. The AxiomLossError thrown by the
    // auditor halts compaction; this event provides diagnostic data.
    this.lumpabilityAuditor.on("lumpability:axiom-loss", (event: AnyEvent) => {
      void this.eventBus.emit(event);
      console.warn(
        `[ORCH] AXIOM LOSS detected in compaction: ${JSON.stringify(event)}`,
      );
    });
  }

  /**
   * #wireEvolutionEvents — connect EventBus events to PriceEvolver feedback handlers.
   *
   * The PriceEvolver listens to regime changes, cohomology updates, SOC metrics,
   * and lumpability audits to compute edge fitness and apply Pólya reinforcement.
   */
  #wireEvolutionEvents(): void {
    this.eventBus.subscribe("regime:classification", (event: AnyEvent) => {
      const e = event as unknown as { regime: string };
      this.priceEvolver.onRegimeChange(e.regime);
    });

    this.eventBus.subscribe("sheaf:h1-obstruction-detected", (event: AnyEvent) => {
      const e = event as unknown as { h1Dimension: number };
      this.priceEvolver.onCohomologyUpdate(e.h1Dimension);
    });

    this.eventBus.subscribe("sheaf:consensus-reached", () => {
      this.priceEvolver.onCohomologyUpdate(0);
    });

    this.eventBus.subscribe("soc:metrics", (event: AnyEvent) => {
      const e = event as unknown as { cdp: number };
      this.priceEvolver.onSOCMetrics(e.cdp);
    });

    this.eventBus.subscribe("lumpability:weak-compression", (event: AnyEvent) => {
      const e = event as unknown as { sourceEntryIds: readonly string[] };
      this.priceEvolver.onWeakLumpability(e.sourceEntryIds);
    });
  }

  /**
   * Register default subscribers for monitoring and observability.
   */
  #registerDefaultSubscribers(): void {
    this.eventBus.subscribe("sheaf:consensus-reached", (event) => {
      const e = event as { h0Dimension?: number };
      console.log(
        `[ORCH] Iteration ${this.#iterationCounter}: Sheaf consensus at h0=${e.h0Dimension ?? "?"}`,
      );
    });

    this.eventBus.subscribe("sheaf:h1-obstruction-detected", (event) => {
      const e = event as { h1Dimension?: number };
      console.log(
        `[ORCH] Iteration ${this.#iterationCounter}: H^1 obstruction dim=${e.h1Dimension ?? "?"}`,
      );
    });

    this.eventBus.subscribe("soc:metrics", (event) => {
      const e = event as {
        iteration?: number;
        cdp?: number;
        vonNeumannEntropy?: number;
        embeddingEntropy?: number;
        surprisingEdgeRatio?: number;
      };
      console.log(
        `[ORCH] Iteration ${e.iteration ?? "?"}: SOC metrics ` +
          `CDP=${(e.cdp ?? 0).toFixed(3)}, ` +
          `VNE=${(e.vonNeumannEntropy ?? 0).toFixed(3)}, ` +
          `EE=${(e.embeddingEntropy ?? 0).toFixed(3)}, ` +
          `SER=${(e.surprisingEdgeRatio ?? 0).toFixed(2)}`,
      );
    });

    this.eventBus.subscribe("phase:transition", (event) => {
      const e = event as {
        iteration?: number;
        correlationCoefficient?: number;
      };
      console.log(
        `[ORCH] Iteration ${e.iteration ?? "?"}: PHASE TRANSITION detected ` +
          `(r=${(e.correlationCoefficient ?? 0).toFixed(3)})`,
      );
    });

    this.eventBus.subscribe("lumpability:weak-compression", (event) => {
      const e = event as {
        summaryNodeId?: string;
        escalationLevel?: number;
        entropyPreservationRatio?: number;
      };
      console.log(
        `[ORCH] WEAK LUMPABILITY at ${e.summaryNodeId ?? "?"} ` +
          `(L${e.escalationLevel ?? "?"}, ratio=${(e.entropyPreservationRatio ?? 0).toFixed(3)})`,
      );
    });

    this.eventBus.subscribe("soc:system1-early-convergence", (event) => {
      const e = event as {
        iteration?: number;
        eeVariance?: number;
        vneSlope?: number;
      };
      console.log(
        `[ORCH] SYSTEM 1 OVERRIDE detected at iteration ${e.iteration ?? "?"}: ` +
          `EE variance=${(e.eeVariance ?? 0).toFixed(4)}, ` +
          `VNE slope=${(e.vneSlope ?? 0).toFixed(4)}`,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Public: runReasoning()
  // -------------------------------------------------------------------------

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
  async runReasoning(prompt: string): Promise<void> {
    // Step 1: Increment iteration counter
    this.#iterationCounter++;

    // Step 2: Preprocess text via TNA
    const preprocessed = this.tnaPreprocessor.preprocess(prompt);

    // Step 3: Build co-occurrence graph from preprocessed tokens
    // ingest() handles both lemmatization and sliding window internally
    this.tnaGraph.ingest(prompt, this.#iterationCounter);

    console.log(
      `[ORCH] Iteration ${this.#iterationCounter}: TNA processed ` +
        `${preprocessed.tokens.length} tokens → graph has ${this.tnaGraph.order} nodes`,
    );

    // Step 4: Run Louvain community detection (only when graph has nodes)
    if (this.tnaGraph.order > 0) {
      const communities = this.tnaLouvain.detect(42 /* deterministic seed */);
      const modularity = this.tnaLouvain.getModularity();
      console.log(
        `[ORCH] Iteration ${this.#iterationCounter}: Communities detected: ` +
          `${communities.communityCount}, modularity=${modularity.toFixed(3)}`,
      );

      // Phase 6: Centrality time-series update (TNA-09)
      // computeIfDue() checks internal interval and computes centrality + updates time series
      this.tnaCentrality.computeIfDue(this.#iterationCounter);

      // Phase 6: Layout computation (TNA-08)
      // computeIfDue() checks internal interval and runs ForceAtlas2 if needed
      if (this.tnaGraph.order >= 3) {
        this.tnaLayout.computeIfDue(this.#iterationCounter);
      }
    }

    // Step 5: Append prompt to LCM
    const entryId = await this.lcmClient.append(prompt);
    console.log(
      `[ORCH] Iteration ${this.#iterationCounter}: Appended to LCM: ${entryId}`,
    );

    // Step 6: Run Sheaf cohomology analysis
    // In a real system, the sheaf is constructed from TNA graph topology.
    // For Phase 5: use the instance sheaf (empty → h0=0, h1=0 → consensus event fires).
    const cohomologyResult = this.cohomologyAnalyzer.analyze(
      this.sheaf,
      this.#iterationCounter,
    );
    console.log(
      `[ORCH] Iteration ${this.#iterationCounter}: Sheaf analysis: ` +
        `h0=${cohomologyResult.h0Dimension}, h1=${cohomologyResult.h1Dimension}`,
    );
    // Events 'sheaf:consensus-reached' or 'sheaf:h1-obstruction-detected' fire here
    // (and are forwarded to eventBus via #wireEventBus handlers above)

    // Step 7: Compute SOC metrics
    // Build SOCInputs from TNA graph outputs.
    // edges: graph edges as numeric index pairs (required by vonNeumannEntropy)
    const graphInstance = this.tnaGraph.getGraph();
    const nodeList = graphInstance.nodes();
    const nodeIndexMap = new Map<string, number>();
    nodeList.forEach((nodeId, idx) => nodeIndexMap.set(nodeId, idx));

    const edges: Array<{ source: number; target: number; weight: number }> = [];
    graphInstance.forEachEdge((_edge, attrs, source, target) => {
      const srcIdx = nodeIndexMap.get(source);
      const tgtIdx = nodeIndexMap.get(target);
      if (srcIdx !== undefined && tgtIdx !== undefined) {
        edges.push({
          source: srcIdx,
          target: tgtIdx,
          weight: (attrs as { weight?: number }).weight ?? 1,
        });
      }
    });

    // Build node embeddings for SOC (cache new nodes only)
    await this.#updateNodeEmbeddings(graphInstance);

    const socInputs: SOCInputs = {
      nodeCount: this.tnaGraph.order,
      edges,
      embeddings: this.#nodeEmbeddings,
      communityAssignments: this.#buildCommunityMap(),
      newEdges: this.#getNewEdges(graphInstance, this.#iterationCounter),
      iteration: this.#iterationCounter,
    };

    // Store previous inputs for Phase 6 tracking
    this.#previousSocInputs = socInputs;

    this.socTracker.computeAndEmit(socInputs);
    // Events 'soc:metrics' and optionally 'phase:transition' fire here

    // Step 8: Evolve reasoning paths via Price equation
    const decomp = this.priceEvolver.evolve(this.#iterationCounter);
    console.log(
      `[ORCH] Iteration ${this.#iterationCounter}: Price equation — ` +
        `selection=${decomp.selection.toFixed(4)}, ` +
        `transmission=${decomp.transmission.toFixed(4)}, ` +
        `explore/exploit=${this.priceEvolver.getExploreExploitRatio().toFixed(2)}`,
    );
    void this.eventBus.emit({
      type: "evolution:price-decomposition",
      iteration: this.#iterationCounter,
      timestamp: Date.now(),
      selection: decomp.selection,
      transmission: decomp.transmission,
      totalChange: decomp.totalChange,
      meanFitness: decomp.meanFitness,
      populationSize: decomp.populationSize,
      regime: decomp.regime,
      learningRate: this.priceEvolver.getCurrentLearningRate(),
      exploreExploitRatio: this.priceEvolver.getExploreExploitRatio(),
    } as AnyEvent);
  }

  // -------------------------------------------------------------------------
  // Public: shutdown()
  // -------------------------------------------------------------------------

  /**
   * shutdown — graceful teardown of the Orchestrator.
   *
   * For Phase 5: placeholder for future resource cleanup (Phase 6+).
   * Future enhancements: drain EventBus, terminate AgentPool, flush LCM.
   */
  async shutdown(): Promise<void> {
    await this.obstructionHandler.shutdown();
    console.log("[ORCH] Shutdown complete.");
  }

  // -------------------------------------------------------------------------
  // Public: inspection helpers
  // -------------------------------------------------------------------------

  /**
   * getIterationCount — returns the number of runReasoning() calls made.
   */
  getIterationCount(): number {
    return this.#iterationCounter;
  }

  /**
   * setIterationCount — restore the iteration counter from a saved state.
   * Used by the persistence layer when loading a previously saved session.
   */
  setIterationCount(count: number): void {
    this.#iterationCounter = count;
  }

  /**
   * getNodeEmbeddings — returns the cached node embedding map.
   * Used by the persistence layer for state serialization.
   */
  getNodeEmbeddings(): ReadonlyMap<string, Float64Array> {
    return this.#nodeEmbeddings;
  }

  /**
   * setNodeEmbeddings — restore node embeddings from a saved state.
   * Used by the persistence layer when loading a previously saved session.
   */
  setNodeEmbeddings(embeddings: Map<string, Float64Array>): void {
    this.#nodeEmbeddings = embeddings;
  }

  /**
   * getState — returns the current operational state (NORMAL/OBSTRUCTED/CRITICAL).
   */
  getState(): OrchestratorState {
    return this.stateManager.getState();
  }

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
   *   - 'lumpability:axiom-loss' (when VK axioms are lost — AxiomLossError thrown)
   *
   * When AxiomLossError is caught, the method re-throws to halt compaction.
   * The caller (EscalationProtocol or orchestrator) MUST catch this and
   * trigger recovery — e.g., re-summarize with lost axioms injected.
   *
   * @param summaryNode    - The SummaryNode produced by compaction.
   * @param sourceEntries  - The original LCMEntries that were compacted.
   * @param escalationLevel - Which level produced this summary (1, 2, or 3).
   * @throws AxiomLossError if VK constraints were lost during compression.
   */
  async auditCompaction(
    summaryNode: SummaryNode,
    sourceEntries: readonly LCMEntry[],
    escalationLevel: EscalationLevel,
  ): Promise<void> {
    await this.lumpabilityAuditor.audit(
      summaryNode,
      sourceEntries,
      escalationLevel,
    );
    // AxiomLossError propagates naturally — caller must handle recovery.
  }

  // -------------------------------------------------------------------------
  // Private Initialization Methods
  // -------------------------------------------------------------------------

  #initLcm(embedder: IEmbedder): void {
    const tokenCounter = new GptTokenCounter();
    const store = new ImmutableStore(tokenCounter);
    const cache = new EmbeddingCache(embedder);
    (this as any).lcmClient = new LCMClient(store, cache, embedder);
  }

  #initSheaf(): void {
    (this as any).sheaf = buildFlatSheaf(2, 1);
    (this as any).cohomologyAnalyzer = new CohomologyAnalyzer();
  }

  #initTna(): void {
    (this as any).tnaPreprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
    (this as any).tnaGraph = new CooccurrenceGraph(this.tnaPreprocessor);
    (this as any).tnaLouvain = new LouvainDetector(this.tnaGraph);
    (this as any).tnaCentrality = new CentralityAnalyzer(this.tnaGraph);
    (this as any).tnaGapDetector = new GapDetector(
      this.tnaGraph,
      this.tnaLouvain,
      this.tnaCentrality,
    );
    (this as any).tnaCatalystGenerator = new CatalystQuestionGenerator(
      this.tnaGraph,
      this.tnaCentrality,
    );
    (this as any).tnaLayout = new LayoutComputer(this.tnaGraph);
    (this as any).tnaSummarizer = new CommunitySummarizer(
      this.tnaGraph,
      this.tnaLouvain,
      this.tnaCentrality,
    );
  }

  #initSoc(): void {
    (this as any).socTracker = new SOCTracker({ correlationWindowSize: 10 });
  }

  #initLumpability(embedder: IEmbedder): void {
    const tokenCounter = new GptTokenCounter();
    (this as any).lumpabilityAuditor = new LumpabilityAuditor(
      embedder,
      tokenCounter,
    );

    // Wire VK axiom preservation checker (Phase 1: embedding-based)
    const vkChecker = new EmbeddingVKChecker(embedder);
    this.lumpabilityAuditor.setVKChecker(vkChecker);
  }

  #initEvolution(): void {
    (this as any).priceEvolver = new PriceEvolver(this.tnaGraph.getGraph());
  }

  #initOrchestration(): void {
    const vdwSpawner = new VdWAgentSpawner(this.eventBus);
    (this as any).obstructionHandler = new ObstructionHandler(
      this.eventBus,
      this.tnaGapDetector,
      this.tnaGraph,
      { agentPoolSize: 4, vdwSpawner },
    );
  }

  // -------------------------------------------------------------------------
  // Private: SOCInputs helpers
  // -------------------------------------------------------------------------

  /** Embed any TNA graph nodes not yet in the cache. */
  async #updateNodeEmbeddings(graph: ReturnType<CooccurrenceGraph["getGraph"]>): Promise<void> {
    const nodesToEmbed: string[] = [];
    graph.forEachNode((nodeId) => {
      if (!this.#nodeEmbeddings.has(nodeId)) {
        nodesToEmbed.push(nodeId);
      }
    });

    if (nodesToEmbed.length === 0) return;

    // Parallelize embedding calls (batches of 10 to avoid overwhelming the API)
    const batchSize = 10;
    for (let i = 0; i < nodesToEmbed.length; i += batchSize) {
      const batch = nodesToEmbed.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (nodeId) => {
          const embedding = await this.#embedder.embed(nodeId);
          return { nodeId, embedding };
        }),
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          this.#nodeEmbeddings.set(result.value.nodeId, result.value.embedding);
        }
      }
    }

    if (nodesToEmbed.length > 0) {
      console.log(
        `[ORCH] Embedded ${this.#nodeEmbeddings.size} TNA nodes (${nodesToEmbed.length} new)`,
      );
    }
  }

  /** Build community assignment map from the Louvain detector. */
  #buildCommunityMap(): Map<string, number> {
    const map = new Map<string, number>();
    const graph = this.tnaGraph.getGraph();
    graph.forEachNode((nodeId, attrs) => {
      const communityId = (attrs as { communityId?: number }).communityId;
      if (communityId !== undefined) {
        map.set(nodeId, communityId);
      }
    });
    return map;
  }

  /** Get edges created at a specific iteration. */
  #getNewEdges(
    graph: ReturnType<CooccurrenceGraph["getGraph"]>,
    iteration: number,
  ): Array<{ source: string; target: string; createdAtIteration: number }> {
    const result: Array<{ source: string; target: string; createdAtIteration: number }> = [];
    graph.forEachEdge((_edge, attrs, source, target) => {
      if ((attrs as { createdAtIteration?: number }).createdAtIteration === iteration) {
        result.push({ source, target, createdAtIteration: iteration });
      }
    });
    return result;
  }
}
