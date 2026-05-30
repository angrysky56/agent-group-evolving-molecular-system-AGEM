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

import {
  LCMClient,
  ImmutableStore,
  EmbeddingCache,
  GptTokenCounter,
  ContextDAG,
  SummaryIndex,
  EscalationProtocol,
  MockCompressor,
  SubgraphRegistry,
  EMBEDDING_DIM,
} from "../lcm/index.js";
import type {
  IEmbedder,
  SummaryNode,
  LCMEntry,
  EscalationLevel,
  ICompressor,
  Subgraph,
} from "../lcm/index.js";
import { cosineSimilarity } from "../lcm/LCMGrep.js";
import type {
  VertexId,
  EdgeId,
  SheafVertex,
  SheafEdge,
} from "../types/index.js";
import { uuidv7 } from "uuidv7";

// ---------------------------------------------------------------------------
// Lumpability module imports
// ---------------------------------------------------------------------------
import {
  LumpabilityAuditor,
  EmbeddingVKChecker,
  AxiomLossError,
} from "../lumpability/index.js";

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

  /** Subgraph registry managing named subgraphs. */
  readonly subgraphRegistry!: SubgraphRegistry;

  /** LCM client: append-only context store with embedding caching. */
  readonly lcmClient!: LCMClient;

  /** Context DAG: tracks pointers from summary nodes to original entries. */
  readonly lcmDag!: ContextDAG;

  /** Escalation protocol: handles multi-level context compression. */
  readonly lcmEscalation!: EscalationProtocol;

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

  /** Injected compressor reference for reflection generation. */
  #compressor: ICompressor | null = null;

  /** Max reasoning steps per VdW agent (configurable via constructor options). */
  #vdwAgentMaxIterations: number | undefined;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Create an Orchestrator instance wiring all four AGEM modules.
   *
   * @param embedder - IEmbedder implementation injected for LCM embedding cache.
   *                   Must implement embed(text: string): Promise<Float64Array>.
   *                   MockEmbedder from src/lcm/interfaces.ts can be used in tests.
   * @param compressor - Optional ICompressor implementation injected for LCM escalation compression.
   *                     MockCompressor is used by default if not provided.
   * @param options - Optional engine tuning.
   * @param options.vdwAgentMaxIterations - Max reasoning steps per VdW agent before
   *                                        self-termination. Overrides the hardcoded default (15).
   *                                        Set via VDW_AGENT_MAX_ITERATIONS in .env.
   */
  constructor(
    embedder: IEmbedder,
    compressor?: ICompressor,
    options?: { vdwAgentMaxIterations?: number },
  ) {
    this.eventBus = new EventBus();
    this.#embedder = embedder;
    this.#vdwAgentMaxIterations = options?.vdwAgentMaxIterations;

    this.#initLcm(embedder, compressor);
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
    this.lumpabilityAuditor.on(
      "lumpability:audit-complete",
      (event: AnyEvent) => {
        void this.eventBus.emit(event);
      },
    );

    this.lumpabilityAuditor.on(
      "lumpability:weak-compression",
      (event: AnyEvent) => {
        void this.eventBus.emit(event);
      },
    );

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

    this.eventBus.subscribe(
      "sheaf:h1-obstruction-detected",
      (event: AnyEvent) => {
        const e = event as unknown as { h1Dimension: number };
        this.priceEvolver.onCohomologyUpdate(e.h1Dimension);
      },
    );

    this.eventBus.subscribe("sheaf:consensus-reached", () => {
      this.priceEvolver.onCohomologyUpdate(0);
    });

    this.eventBus.subscribe("soc:metrics", (event: AnyEvent) => {
      const e = event as unknown as { cdp: number };
      this.priceEvolver.onSOCMetrics(e.cdp);
    });

    this.eventBus.subscribe(
      "lumpability:weak-compression",
      (event: AnyEvent) => {
        const e = event as unknown as { sourceEntryIds: readonly string[] };
        this.priceEvolver.onWeakLumpability(e.sourceEntryIds);
      },
    );
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
  async runReasoning(prompt: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("Aborted");
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
    const entryId = await this.lcmClient.append(prompt, signal);
    if (signal?.aborted) throw new Error("Aborted");
    console.log(
      `[ORCH] Iteration ${this.#iterationCounter}: Appended to LCM: ${entryId}`,
    );

    // Context compaction / escalation check
    const store = this.lcmClient.store;
    const allEntries = store.getAll();
    const concatenatedText = allEntries.map((e) => e.content).join("\n\n");
    const result = await this.lcmEscalation.escalate(concatenatedText);
    if (result.level > 0) {
      const originalEntryIds = allEntries.map((e) => e.id);

      // Generate reflections at compaction (Move C1)
      let reflections: Array<{ question: string; answer: string }> = [];
      if (
        this.#compressor &&
        typeof this.#compressor.generateReflections === "function"
      ) {
        try {
          reflections = await this.#compressor.generateReflections(
            result.output,
          );
        } catch (err) {
          console.error("[ORCH] Reflection generation failed:", err);
        }
      }

      const summaryNode: SummaryNode = {
        id: `summary-${uuidv7()}`,
        content: result.output,
        originalEntryIds,
        createdAt: Date.now(),
        version: 1,
        metrics: {
          level: result.level,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          compressorUsed: result.compressorUsed,
          reflections,
        },
        metricHistory: [],
        intermediateCompressions: [],
      };

      // Seed reflection question embeddings in the active subgraph cache
      const active = this.subgraphRegistry.activeSubgraph;
      for (let i = 0; i < reflections.length; i++) {
        const ref = reflections[i];
        if (ref && ref.question) {
          try {
            const vec = await this.#embedder.embed(ref.question, signal);
            active.cache.seed(`${summaryNode.id}-ref-${i}`, vec);
          } catch (err) {
            console.error(
              `[ORCH] Failed to embed reflection question ${i}:`,
              err,
            );
          }
        }
      }

      this.lcmDag.addSummaryNode(summaryNode);
      console.log(
        `[ORCH] Iteration ${this.#iterationCounter}: LCM context escalation triggered level ${result.level} compaction: ${summaryNode.id}`,
      );

      // Route through existing auditCompaction() hook
      try {
        await this.auditCompaction(
          summaryNode,
          allEntries,
          result.level as EscalationLevel,
          signal,
        );
      } catch (err) {
        if (err instanceof AxiomLossError) {
          console.warn(`[ORCH] AxiomLossError in compaction: ${err.message}`);
          throw err;
        }
        throw err;
      }
    }

    // Step 6: Run Sheaf cohomology analysis
    // Dynamically construct CellularSheaf base graph from SubgraphRegistry (Move B2)
    const dynamicSheaf = await this.buildSheafFromRegistry();
    (this as any).sheaf = dynamicSheaf;

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
    await this.#updateNodeEmbeddings(graphInstance, signal);
    if (signal?.aborted) throw new Error("Aborted");

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
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new Error("Aborted");
    await this.lumpabilityAuditor.audit(
      summaryNode,
      sourceEntries,
      escalationLevel,
    );
    // AxiomLossError propagates naturally — caller must handle recovery.
  }

  // -------------------------------------------------------------------------
  #initLcm(embedder: IEmbedder, compressor?: ICompressor): void {
    const tokenCounter = new GptTokenCounter();
    const registry = new SubgraphRegistry(embedder, tokenCounter);
    (this as any).subgraphRegistry = registry;

    const active = registry.activeSubgraph;
    (this as any).lcmClient = new LCMClient(
      active.store,
      active.cache,
      embedder,
    );
    (this as any).lcmDag = active.dag;

    const thresholds = {
      level1TokenLimit: 1000,
      level2MinRatio: 0.8,
      level3KTokens: 2000,
      coherenceSimilarityThreshold: 0.7,
    };
    const comp = compressor ?? new MockCompressor();
    this.#compressor = comp;
    (this as any).lcmEscalation = new EscalationProtocol(
      comp,
      tokenCounter,
      thresholds,
    );
  }

  /** Activate a subgraph and wire its client and DAG. */
  activateSubgraph(id: string): void {
    this.subgraphRegistry.activate(id);
    const active = this.subgraphRegistry.activeSubgraph;
    (this as any).lcmClient = new LCMClient(
      active.store,
      active.cache,
      this.#embedder,
    );
    (this as any).lcmDag = active.dag;
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
    const vdwConfig =
      this.#vdwAgentMaxIterations !== undefined
        ? { agentMaxIterations: this.#vdwAgentMaxIterations }
        : {};
    const vdwSpawner = new VdWAgentSpawner(this.eventBus, vdwConfig);
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
  async #updateNodeEmbeddings(
    graph: ReturnType<CooccurrenceGraph["getGraph"]>,
    signal?: AbortSignal,
  ): Promise<void> {
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
          if (signal?.aborted) throw new Error("Aborted");
          const embedding = await this.#embedder.embed(nodeId, signal);
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
    const result: Array<{
      source: string;
      target: string;
      createdAtIteration: number;
    }> = [];
    graph.forEachEdge((_edge, attrs, source, target) => {
      if (
        (attrs as { createdAtIteration?: number }).createdAtIteration ===
        iteration
      ) {
        result.push({ source, target, createdAtIteration: iteration });
      }
    });
    return result;
  }

  /**
   * buildSheafFromRegistry — assemble a CellularSheaf over the subgraph registry.
   *
   * What this builds:
   *   - Vertices = subgraphs. Each carries a scalar (dim=1) stalk: a single
   *     real-valued "section" representing the subgraph's level of activation.
   *   - Edges = pairs of subgraphs whose concept centroids exceed `threshold`.
   *     The edge stalk is also scalar.
   *   - sourceRestriction: F_{u <- e} = [1.0]  (identity).
   *     targetRestriction: F_{v <- e} = [sim]  (cosine similarity of the two
   *       concept centroids, in [-1, 1]).
   *
   * What this means mathematically:
   *   Consensus (B*x = 0) reads as  x_v * sim_uv = x_u  on each edge. A global
   *   section is any vertex assignment whose neighboring values agree weighted
   *   by their semantic similarity. H^0 = #components-of-the-similarity-graph
   *   = the number of disconnected semantic clusters (up to numerical kernel).
   *   H^1 emerges when, around a cycle of subgraphs, the product of similarity
   *   weights around the loop does NOT equal 1 — i.e. the system cannot
   *   self-consistently weigh the same content via two different paths. That
   *   is a real semantic obstruction, not graph topology.
   *
   * What this is NOT (yet):
   *   The full vector-valued sheaf, where stalks carry the EMBED_DIM-dim
   *   concept vectors themselves and restriction maps are linear projections
   *   between concept bases. That lift is correct semantically but requires
   *   per-pair basis fitting (Procrustes / orthogonal regression) and is
   *   deferred. See TODO below.
   *
   *   Note on the "Kronecker shortcut": IF every restriction map were
   *     sim_uv * I_{EMBED_DIM}
   *   then the full coboundary would factor as B_scalar (x) I_{EMBED_DIM},
   *   and  dim(H^k_full) = EMBED_DIM * dim(H^k_scalar). In that special case
   *   the scalar computation here would be the correct optimized form. But
   *   that case is a strong assumption (it says every restriction is a
   *   uniform rescale of every embedding component, which loses any rotation
   *   between subgraph concept bases). The honest read is: this is a scalar
   *   sheaf that captures similarity-weighted consensus and H^1 around loops,
   *   and is strictly more informative than the prior identity-mapped version
   *   (which collapsed to graph Betti numbers ignoring similarity entirely).
   *
   * TODO(sheaf-vector-lift): promote to vector-valued stalks. Steps:
   *   1. Set vertex stalkSpace.dim = EMBED_DIM, edge stalkSpace.dim = EMBED_DIM.
   *   2. Fit an orthogonal map M_{u<-v} from subgraph u's concept basis to
   *      subgraph v's basis (Procrustes alignment of top-k summary embeddings).
   *   3. sourceRestriction = I_{EMBED_DIM}; targetRestriction = sim * M_{u<-v}.
   *   4. Cohomology then captures basis-rotation obstructions, not just
   *      scalar-weight ones.
   *   The TFLOPs cost of SVD over a (num_edges * EMBED_DIM) x (num_subgraphs *
   *   EMBED_DIM) coboundary is the reason this is deferred until restriction
   *   maps actually need vector content — e.g. once cross-subgraph reflection
   *   matching uses per-component projections rather than scalar cosines.
   */
  async buildSheafFromRegistry(): Promise<CellularSheaf> {
    const subgraphs = this.subgraphRegistry.list();
    const threshold = 0.7;

    const vertices: SheafVertex[] = subgraphs.map((sub) => ({
      id: sub.id as VertexId,
      stalkSpace: { dim: 1, label: sub.name },
    }));

    const edges: SheafEdge[] = [];

    // Pre-warm: ensure concept centroids exist for every subgraph that has
    // root summaries or entries. Skip pairs where either subgraph has no
    // embeddable content.
    for (const sub of subgraphs) {
      const rootSummaries = sub.summaryIndex
        .list()
        .filter((node) => sub.dag.getParentSummary(node.id) === undefined);
      const ids: Array<{ id: string; text: string }> = [];
      if (rootSummaries.length > 0) {
        for (const node of rootSummaries) {
          if (!sub.cache.getEmbedding(node.id))
            ids.push({ id: node.id, text: node.content });
        }
      } else {
        for (const entry of sub.store.getAll()) {
          if (!sub.cache.getEmbedding(entry.id))
            ids.push({ id: entry.id, text: entry.content });
        }
      }
      for (const { id, text } of ids) {
        const vec = await this.#embedder.embed(text);
        sub.cache.seed(id, vec);
      }
    }

    for (let i = 0; i < subgraphs.length; i++) {
      for (let j = i + 1; j < subgraphs.length; j++) {
        const subA = subgraphs[i]!;
        const subB = subgraphs[j]!;

        // O(1) per pair using the precomputed L2-normalized concept centroids.
        const sim = this.subgraphRegistry.conceptSimilarity(subA.id, subB.id);
        if (sim < threshold) continue;

        // Clamp to a small finite range to keep the coboundary well-conditioned.
        // Negative similarities (semantic opposition) are valid sheaf data, but
        // we only emit an edge above `threshold` so the path doesn't trigger.
        const weight = Math.max(-1, Math.min(1, sim));

        const edgeId = `e-${subA.id}-${subB.id}` as EdgeId;
        edges.push({
          id: edgeId,
          sourceVertex: subA.id as VertexId,
          targetVertex: subB.id as VertexId,
          stalkSpace: { dim: 1, label: `${subA.name}<->${subB.name}` },
          sourceRestriction: {
            sourceVertexId: subA.id as VertexId,
            edgeId,
            sourceDim: 1,
            targetDim: 1,
            entries: new Float64Array([1.0]),
          },
          targetRestriction: {
            sourceVertexId: subB.id as VertexId,
            edgeId,
            sourceDim: 1,
            targetDim: 1,
            entries: new Float64Array([weight]),
          },
        });
      }
    }

    return new CellularSheaf(vertices, edges);
  }

  /**
   * stagedQuery(query) — Grounding -> Entity -> Synthesis staged query protocol (Move C2)
   */
  async stagedQuery(query: string, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new Error("Aborted");

    // Stage 1: Grounding/Selection
    const ranked = await this.subgraphRegistry.route(query, this.#embedder);
    const topRanked = ranked[0];
    const topSubgraph = topRanked
      ? this.subgraphRegistry.get(topRanked.subgraphId)
      : this.subgraphRegistry.activeSubgraph;
    if (!topSubgraph) {
      throw new Error("[ORCH] No valid subgraphs available for staged query");
    }

    console.log(
      `[ORCH] Staged Query Grounding: Selected Subgraph '${topSubgraph.name}' (${topSubgraph.id}) with score ${topRanked?.score.toFixed(3) ?? "N/A"}`,
    );

    // Stage 2: Entity ID / Target Identification
    const rootSummaries = topSubgraph.summaryIndex
      .list()
      .filter(
        (node) => topSubgraph.dag.getParentSummary(node.id) === undefined,
      );
    const candidates =
      rootSummaries.length > 0
        ? rootSummaries.map((n) => ({
            id: n.id,
            content: n.content,
            type: "summary" as const,
          }))
        : topSubgraph.store
            .getAll()
            .map((e) => ({
              id: e.id,
              content: e.content,
              type: "entry" as const,
            }));

    if (candidates.length === 0) {
      return "No context found to answer query.";
    }

    const queryVector = await this.#embedder.embed(query, signal);
    let bestCandidate: (typeof candidates)[0] | null = null;
    let maxSim = -1.0;

    for (const cand of candidates) {
      let vec = topSubgraph.cache.getEmbedding(cand.id);
      if (!vec) {
        vec = await this.#embedder.embed(cand.content, signal);
        topSubgraph.cache.seed(cand.id, vec);
      }
      const sim = cosineSimilarity(queryVector, vec);
      if (sim > maxSim) {
        maxSim = sim;
        bestCandidate = cand;
      }
    }

    console.log(
      `[ORCH] Staged Query Entity ID: Best target is ${bestCandidate?.type} '${bestCandidate?.id}' with similarity ${maxSim.toFixed(3)}`,
    );

    // Stage 3: Synthesis
    let contextText = "";
    if (bestCandidate) {
      if (bestCandidate.type === "summary") {
        const originalEntries = topSubgraph.dag.getEntriesForSummary(
          bestCandidate.id,
        );
        contextText = originalEntries.map((e) => e.content).join("\n\n");
      } else {
        contextText = bestCandidate.content;
      }
    }

    if (this.#compressor && typeof this.#compressor.synthesize === "function") {
      return await this.#compressor.synthesize(query, contextText);
    }

    return `Synthesized answer based on context:\n${contextText}`;
  }
}
