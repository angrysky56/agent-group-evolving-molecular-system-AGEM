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
import { CellularSheaf, CohomologyAnalyzer, buildFlatSheaf } from '../sheaf/index.js';

// ---------------------------------------------------------------------------
// LCM module imports
// ---------------------------------------------------------------------------
import { LCMClient, ImmutableStore, EmbeddingCache, GptTokenCounter } from '../lcm/index.js';
import type { IEmbedder } from '../lcm/index.js';

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
} from '../tna/index.js';

// ---------------------------------------------------------------------------
// SOC module imports
// ---------------------------------------------------------------------------
import { SOCTracker } from '../soc/index.js';
import type { SOCInputs } from '../soc/index.js';

// ---------------------------------------------------------------------------
// Orchestrator internal imports
// ---------------------------------------------------------------------------
import { EventBus } from './EventBus.js';
import { OrchestratorState, OrchestratorStateManager } from './OrchestratorState.js';
import type { StateChangeEvent } from './OrchestratorState.js';
import { ObstructionHandler } from './ObstructionHandler.js';
import { VdWAgentSpawner } from './VdWAgentSpawner.js';
import type { AnyEvent } from './interfaces.js';

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

  /** SOC tracker: computes all five SOC metrics and detects phase transitions. */
  readonly socTracker: SOCTracker;

  /** State manager: tracks NORMAL/OBSTRUCTED/CRITICAL operational modes. */
  readonly stateManager: OrchestratorStateManager;

  /** Obstruction handler: H^1 detection → gapDetector agent spawn pipeline. */
  readonly obstructionHandler: ObstructionHandler;

  // -------------------------------------------------------------------------
  // Private fields
  // -------------------------------------------------------------------------

  /** Counter incremented each time runReasoning() is called. */
  #iterationCounter: number = 0;

  /** Previous SOC inputs for reference (unused in Phase 5, ready for Phase 6). */
  #previousSocInputs: SOCInputs | null = null;

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
    // Step 1: Instantiate EventBus (central coordination point)
    this.eventBus = new EventBus();

    // Step 2: Instantiate LCM components
    // ImmutableStore requires an ITokenCounter for deterministic token counting.
    const tokenCounter = new GptTokenCounter();
    const store = new ImmutableStore(tokenCounter);
    const cache = new EmbeddingCache(embedder);
    this.lcmClient = new LCMClient(store, cache, embedder);

    // Step 3: Instantiate Sheaf components
    // CellularSheaf(vertices, edges): use a minimal 2-vertex flat sheaf for Phase 5.
    // In a real system, the sheaf topology would be constructed from TNA graph structure.
    // buildFlatSheaf(2, 1) creates a 2-vertex path sheaf with 1-dim identity restriction maps.
    // H^0 = 1 (one global section), H^1 = 0 (no obstruction) — triggers consensus event.
    this.sheaf = buildFlatSheaf(2, 1);
    this.cohomologyAnalyzer = new CohomologyAnalyzer();

    // Step 4: Instantiate TNA components
    // Note: CooccurrenceGraph requires a Preprocessor argument (dependency injection).
    // LouvainDetector and CentralityAnalyzer require a CooccurrenceGraph.
    // GapDetector requires all three TNA components.
    this.tnaPreprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
    this.tnaGraph = new CooccurrenceGraph(this.tnaPreprocessor);
    this.tnaLouvain = new LouvainDetector(this.tnaGraph);
    this.tnaCentrality = new CentralityAnalyzer(this.tnaGraph);
    this.tnaGapDetector = new GapDetector(this.tnaGraph, this.tnaLouvain, this.tnaCentrality);

    // Phase 6: Instantiate CatalystQuestionGenerator (TNA-07)
    this.tnaCatalystGenerator = new CatalystQuestionGenerator(
      this.tnaGraph,
      this.tnaCentrality
    );

    // Step 5: Instantiate SOC
    this.socTracker = new SOCTracker({ correlationWindowSize: 10 });

    // Step 6: Instantiate StateManager
    this.stateManager = new OrchestratorStateManager(this.eventBus);

    // Step 7b: Instantiate VdW agent spawner (Phase 6: ORCH-06)
    const vdwSpawner = new VdWAgentSpawner(this.eventBus);

    // Step 7: Instantiate ObstructionHandler (ROADMAP criteria #3) with VdW spawner injection
    this.obstructionHandler = new ObstructionHandler(
      this.eventBus,
      this.tnaGapDetector,
      this.tnaGraph,
      { agentPoolSize: 4, vdwSpawner }
    );

    // Step 8: Wire event emissions to EventBus
    this.#wireEventBus();

    // Step 9: Register default event subscribers (logging/monitoring)
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
    // From CohomologyAnalyzer (EventEmitter)
    this.cohomologyAnalyzer.on('sheaf:consensus-reached', (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });

    this.cohomologyAnalyzer.on('sheaf:h1-obstruction-detected', (event: AnyEvent) => {
      void this.eventBus.emit(event);

      // StateManager updates on H^1 detection
      // The event has h1Dimension field for obstruction events
      const h1Dimension = (event as { h1Dimension?: number }).h1Dimension ?? 0;
      this.stateManager.updateMetrics(h1Dimension);

      // Phase 6: Forward H^1 dimension to VdW spawner for hysteresis tracking
      this.obstructionHandler.updateH1ForSpawner(h1Dimension);
    });

    // From SOCTracker (EventEmitter)
    this.socTracker.on('soc:metrics', (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });

    this.socTracker.on('phase:transition', (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });

    // Phase 6: Forward regime:classification events from SOCTracker to EventBus
    // and then to ObstructionHandler for VdW spawner regime gating
    this.socTracker.on('regime:classification', (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });

    // Phase 6: Forward regime classification to ObstructionHandler for VdW spawner
    this.eventBus.subscribe('regime:classification', (event: AnyEvent) => {
      const regimeEvent = event as unknown as { regime: string };
      this.obstructionHandler.updateRegime(regimeEvent.regime);
    });

    // Phase 6: Wire CentralityAnalyzer events (TNA-09) to EventBus
    this.tnaCentrality.on('tna:centrality-change-detected', (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });
    this.tnaCentrality.on('tna:topology-reorganized', (event: AnyEvent) => {
      void this.eventBus.emit(event);
    });

    // Phase 6: Adjust centrality computation interval based on regime
    this.eventBus.subscribe('regime:classification', (event: AnyEvent) => {
      const regimeEvent = event as unknown as { regime: string };
      this.tnaCentrality.adjustInterval(regimeEvent.regime);
    });

    // StateManager state changes are emitted via EventBus internally — subscribe for logging
    this.eventBus.subscribe('orch:state-changed', (event) => {
      const stateEvent = event as unknown as StateChangeEvent;
      console.log(
        `[ORCH] Iteration ${this.#iterationCounter}: State transition to ` +
        `${stateEvent.newState} (reason: ${stateEvent.reason})`
      );
    });
  }

  /**
   * Register default subscribers for monitoring and observability.
   */
  #registerDefaultSubscribers(): void {
    this.eventBus.subscribe('sheaf:consensus-reached', (event) => {
      const e = event as { h0Dimension?: number };
      console.log(
        `[ORCH] Iteration ${this.#iterationCounter}: Sheaf consensus at h0=${e.h0Dimension ?? '?'}`
      );
    });

    this.eventBus.subscribe('sheaf:h1-obstruction-detected', (event) => {
      const e = event as { h1Dimension?: number };
      console.log(
        `[ORCH] Iteration ${this.#iterationCounter}: H^1 obstruction dim=${e.h1Dimension ?? '?'}`
      );
    });

    this.eventBus.subscribe('soc:metrics', (event) => {
      const e = event as {
        iteration?: number;
        cdp?: number;
        vonNeumannEntropy?: number;
        embeddingEntropy?: number;
        surprisingEdgeRatio?: number;
      };
      console.log(
        `[ORCH] Iteration ${e.iteration ?? '?'}: SOC metrics ` +
        `CDP=${(e.cdp ?? 0).toFixed(3)}, ` +
        `VNE=${(e.vonNeumannEntropy ?? 0).toFixed(3)}, ` +
        `EE=${(e.embeddingEntropy ?? 0).toFixed(3)}, ` +
        `SER=${(e.surprisingEdgeRatio ?? 0).toFixed(2)}`
      );
    });

    this.eventBus.subscribe('phase:transition', (event) => {
      const e = event as { iteration?: number; correlationCoefficient?: number };
      console.log(
        `[ORCH] Iteration ${e.iteration ?? '?'}: PHASE TRANSITION detected ` +
        `(r=${(e.correlationCoefficient ?? 0).toFixed(3)})`
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
      `${preprocessed.tokens.length} tokens → graph has ${this.tnaGraph.order} nodes`
    );

    // Step 4: Run Louvain community detection (only when graph has nodes)
    if (this.tnaGraph.order > 0) {
      const communities = this.tnaLouvain.detect(42 /* deterministic seed */);
      const modularity = this.tnaLouvain.getModularity();
      console.log(
        `[ORCH] Iteration ${this.#iterationCounter}: Communities detected: ` +
        `${communities.communityCount}, modularity=${modularity.toFixed(3)}`
      );

      // Phase 6: Centrality time-series update (TNA-09)
      // computeIfDue() checks internal interval and computes centrality + updates time series
      this.tnaCentrality.computeIfDue(this.#iterationCounter);
    }

    // Step 5: Append prompt to LCM
    const entryId = await this.lcmClient.append(prompt);
    console.log(`[ORCH] Iteration ${this.#iterationCounter}: Appended to LCM: ${entryId}`);

    // Step 6: Run Sheaf cohomology analysis
    // In a real system, the sheaf is constructed from TNA graph topology.
    // For Phase 5: use the instance sheaf (empty → h0=0, h1=0 → consensus event fires).
    const cohomologyResult = this.cohomologyAnalyzer.analyze(
      this.sheaf,
      this.#iterationCounter
    );
    console.log(
      `[ORCH] Iteration ${this.#iterationCounter}: Sheaf analysis: ` +
      `h0=${cohomologyResult.h0Dimension}, h1=${cohomologyResult.h1Dimension}`
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

    const socInputs: SOCInputs = {
      nodeCount: this.tnaGraph.order,
      edges,
      embeddings: new Map<string, Float64Array>(), // populated from embedder in real system
      communityAssignments: new Map<string, number>(), // populated from Louvain in real system
      newEdges: [], // tracks edges added this iteration in real system
      iteration: this.#iterationCounter,
    };

    // Store previous inputs for Phase 6 tracking
    this.#previousSocInputs = socInputs;

    this.socTracker.computeAndEmit(socInputs);
    // Events 'soc:metrics' and optionally 'phase:transition' fire here
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
    console.log('[ORCH] Shutdown complete.');
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
   * getState — returns the current operational state (NORMAL/OBSTRUCTED/CRITICAL).
   */
  getState(): OrchestratorState {
    return this.stateManager.getState();
  }
}
