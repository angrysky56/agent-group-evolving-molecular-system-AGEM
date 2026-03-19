/**
 * AGEM Engine Bridge.
 *
 * Bridges the chat interface with the REAL AGEM computation engine.
 * Orchestrates AGEM cycles based on user prompts and returns
 * structured results as artifacts and state snapshots.
 *
 * This imports the actual Orchestrator from src/orchestrator/ and
 * wires all subsystem APIs (Sheaf, LCM, TNA, SOC) into callable tools.
 */

import type {
  AgemStateSnapshot,
  Artifact,
  GraphEdge,
  GraphNode,
  GraphSummary,
  CohomologySnapshot,
  SOCSnapshot,
  GapSnapshot,
  CatalystQuestionResult,
  ContextSearchResult,
  SystemEvent,
} from "../../../shared/types.js";

import { Orchestrator } from "../../../../src/orchestrator/index.js";
import { computeCohomology } from "../../../../src/sheaf/CohomologyAnalyzer.js";
import {
  MockEmbedder,
  GptTokenCounter,
  ImmutableStore,
  EmbeddingCache,
  LCMGrep,
} from "../../../../src/lcm/index.js";
import type { GapMetrics } from "../../../../src/tna/interfaces.js";

/* ─── AGEM Engine Bridge ─── */

/**
 * AgemBridge — live integration layer between the chat interface
 * and the AGEM Orchestrator engine.
 *
 * All tool methods return plain serialisable objects suitable for
 * JSON.stringify() in SSE event payloads.
 */
class AgemBridge {
  #orchestrator: Orchestrator;
  #grep: LCMGrep;
  #eventCounter = 0;

  /** Connected SSE clients for /system/events */
  #sseClients: Set<import("express").Response> = new Set();

  constructor() {
    const embedder = new MockEmbedder();
    this.#orchestrator = new Orchestrator(embedder);
    this.#grep = this.#buildGrep(embedder);
  }

  /* ─────────────── SSE Client Management ─────────────── */

  /** Register an SSE client for system event streaming. */
  addSSEClient(res: import("express").Response): void {
    this.#sseClients.add(res);
    // Send initial state on connect
    this.broadcastEvent({
      id: `evt-${++this.#eventCounter}`,
      type: "agem:state-update",
      timestamp: Date.now(),
      iteration: this.#orchestrator.getIterationCount(),
      severity: "info",
      summary: "Connected to AGEM system events",
      data: { state: this.getState() },
    });
  }

  /** Remove a disconnected SSE client. */
  removeSSEClient(res: import("express").Response): void {
    this.#sseClients.delete(res);
  }

  /** Broadcast a SystemEvent to all connected SSE clients. */
  broadcastEvent(event: SystemEvent): void {
    const payload = `event: system_event\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of this.#sseClients) {
      try {
        client.write(payload);
      } catch {
        this.#sseClients.delete(client);
      }
    }
  }

  /** Create and broadcast a typed event. */
  #emitEvent(
    type: SystemEvent["type"],
    severity: SystemEvent["severity"],
    summary: string,
    data?: Record<string, unknown>,
  ): void {
    this.broadcastEvent({
      id: `evt-${++this.#eventCounter}`,
      type,
      timestamp: Date.now(),
      iteration: this.#orchestrator.getIterationCount(),
      severity,
      summary,
      data,
    });
  }

  /* ─────────────── State ─────────────── */

  /** Get the current AGEM engine state snapshot. */
  getState(): AgemStateSnapshot {
    const orch = this.#orchestrator;

    // Compute gap count (re-detect on demand)
    let gapCount = 0;
    try {
      if (orch.tnaGraph.order > 0) {
        orch.tnaLouvain.detect(42);
        orch.tnaCentrality.compute();
        const gaps = orch.tnaGapDetector.findGaps();
        gapCount = gaps.length;
      }
    } catch {
      // Gaps not available yet
    }

    // Sheaf energy approximation: h1Dimension from last cohomology
    let sheafEnergy = 0;
    try {
      const cohom = computeCohomology(orch.sheaf);
      sheafEnergy = cohom.h1Dimension;
    } catch {
      // Sheaf not ready
    }

    // Community count from last Louvain run
    let communities = 0;
    try {
      const result = orch.tnaLouvain.detect(42);
      communities = result.communityCount;
    } catch {
      // No communities yet
    }

    return {
      agent_count: 0, // VdW agents are internal; no external pool yet
      sheaf_energy: sheafEnergy,
      gap_count: gapCount,
      iteration: orch.getIterationCount(),
      communities,
      operational_state: this.#mapOperationalState(orch.getState()),
      graph_summary: this.getGraphSummary(),
      soc: this.getSOCMetrics(),
      cohomology: this.#getSafeCohomology(),
      regime: this.#getRegimeData(),
      lumpability: this.#getLumpabilityData(),
    };
  }

  /** Map orchestrator state string to dashboard operational state. */
  #mapOperationalState(state: string): "NORMAL" | "OBSTRUCTED" | "CRITICAL" {
    if (state === "OBSTRUCTED" || state === "H1_OBSTRUCTION") return "OBSTRUCTED";
    if (state === "CRITICAL" || state === "ERROR") return "CRITICAL";
    return "NORMAL";
  }

  /** Get regime data for dashboard, returns null-safe object. */
  #getRegimeData() {
    const regime = this.#orchestrator.socTracker.getRegimeMetrics();
    if (!regime) return undefined;
    return {
      regime: regime.regime,
      cdp_variance: regime.cdpVariance,
      correlation_consistency: regime.correlationConsistency,
      persistence_iterations: regime.persistenceIterations,
    };
  }

  /** Get lumpability data for dashboard. */
  #getLumpabilityData() {
    // LumpabilityAuditor is on ComposeRootModule, not base Orchestrator.
    // Return placeholder until full CRM integration is wired.
    return undefined;
  }

  /** Safe cohomology getter for dashboard (returns undefined if sheaf empty). */
  #getSafeCohomology(): CohomologySnapshot | undefined {
    try {
      return this.getCohomology();
    } catch {
      return undefined;
    }
  }

  /** Get the full graph for visualisation. */
  getGraphSummary(): GraphSummary {
    const graph = this.#orchestrator.tnaGraph.getGraph();
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    graph.forEachNode((nodeId, attrs) => {
      const a = attrs as Record<string, unknown>;
      nodes.push({
        id: nodeId,
        label: (a.lemma as string) ?? nodeId,
        community: a.communityId as number | undefined,
        size: a.tfidfWeight as number | undefined,
      });
    });

    graph.forEachEdge((_edge, attrs, source, target) => {
      edges.push({
        source,
        target,
        weight: (attrs as { weight?: number }).weight,
      });
    });

    return { node_count: nodes.length, edge_count: edges.length, nodes, edges };
  }

  /* ─────────────── Run Cycle ─────────────── */

  /**
   * Run a full AGEM orchestration cycle.
   *
   * 1. Calls Orchestrator.runReasoning(prompt)
   * 2. Gathers post-cycle state
   * 3. Returns structured artifacts
   */
  async runCycle(
    userMessage: string,
    _onProgress?: (event: string, data: unknown) => void,
  ): Promise<{ artifacts: Artifact[]; state: AgemStateSnapshot }> {
    this.#emitEvent("agem:state-update", "info", `Starting cycle: ${userMessage.slice(0, 80)}`);

    await this.#orchestrator.runReasoning(userMessage);

    const state = this.getState();
    const latestSOC = this.#orchestrator.socTracker.getLatestMetrics();

    const artifacts: Artifact[] = [
      {
        id: `artifact_${state.iteration}`,
        type: "markdown",
        title: "AGEM Cycle Result",
        content: [
          `## Cycle ${state.iteration}`,
          "",
          `**Input**: ${userMessage.slice(0, 200)}`,
          "",
          "### Engine Status",
          `- Iteration: ${state.iteration}`,
          `- Operational State: ${this.#orchestrator.getState()}`,
          `- Graph Nodes: ${state.graph_summary?.node_count ?? 0}`,
          `- Graph Edges: ${state.graph_summary?.edge_count ?? 0}`,
          `- Communities: ${state.communities}`,
          `- Sheaf H¹ (obstruction): ${state.sheaf_energy}`,
          `- Gaps Detected: ${state.gap_count}`,
          "",
          "### SOC Metrics",
          latestSOC
            ? [
                `- Von Neumann Entropy: ${latestSOC.vonNeumannEntropy.toFixed(4)}`,
                `- Embedding Entropy: ${latestSOC.embeddingEntropy.toFixed(4)}`,
                `- CDP: ${latestSOC.cdp.toFixed(4)}`,
                `- Surprising Edge Ratio: ${latestSOC.surprisingEdgeRatio.toFixed(4)}`,
                `- Correlation: ${latestSOC.correlationCoefficient.toFixed(4)}`,
                `- Phase Transition: ${latestSOC.isPhaseTransition ? "YES" : "No"}`,
              ].join("\n")
            : "- No SOC metrics computed yet.",
        ].join("\n"),
      },
    ];

    // Broadcast post-cycle events to SSE clients
    this.#emitEvent("agem:state-update", "success",
      `Cycle ${state.iteration} complete — ${state.graph_summary?.node_count ?? 0} nodes, ${state.communities} communities`,
      { state },
    );

    if (latestSOC) {
      this.#emitEvent("soc:metrics", "info",
        `VNE=${latestSOC.vonNeumannEntropy.toFixed(3)} EE=${latestSOC.embeddingEntropy.toFixed(3)} CDP=${latestSOC.cdp.toFixed(3)}`,
        {
          vne: latestSOC.vonNeumannEntropy,
          ee: latestSOC.embeddingEntropy,
          cdp: latestSOC.cdp,
          ser: latestSOC.surprisingEdgeRatio,
          correlation: latestSOC.correlationCoefficient,
          iteration: latestSOC.iteration,
        },
      );

      if (latestSOC.isPhaseTransition) {
        this.#emitEvent("phase:transition", "warning",
          `Phase transition detected at iteration ${latestSOC.iteration}`,
        );
      }
    }

    if (state.sheaf_energy > 0) {
      this.#emitEvent("sheaf:h1-obstruction-detected", "warning",
        `H¹ obstruction: dimension ${state.sheaf_energy}`,
        { h1_dimension: state.sheaf_energy },
      );
    }

    if (state.regime) {
      this.#emitEvent("regime:classification", "info",
        `Regime: ${state.regime.regime} (persistence: ${state.regime.persistence_iterations})`,
        state.regime as unknown as Record<string, unknown>,
      );
    }

    return { artifacts, state };
  }

  /* ─────────────── Cohomology ─────────────── */

  /** Get current sheaf cohomology analysis. */
  getCohomology(): CohomologySnapshot {
    const cohom = computeCohomology(this.#orchestrator.sheaf);
    return {
      h0_dimension: cohom.h0Dimension,
      h1_dimension: cohom.h1Dimension,
      has_obstruction: cohom.hasObstruction,
      coboundary_rank: cohom.coboundaryRank,
      tolerance: cohom.tolerance,
    };
  }

  /* ─────────────── SOC Metrics ─────────────── */

  /** Get latest SOC metrics and regime classification. */
  getSOCMetrics(): SOCSnapshot {
    const tracker = this.#orchestrator.socTracker;
    const latest = tracker.getLatestMetrics();
    const regime = tracker.getRegimeMetrics();
    const trend = tracker.getMetricsTrend();
    const history = tracker.getMetricsHistory();

    return {
      latest: latest
        ? {
            iteration: latest.iteration,
            von_neumann_entropy: latest.vonNeumannEntropy,
            embedding_entropy: latest.embeddingEntropy,
            cdp: latest.cdp,
            surprising_edge_ratio: latest.surprisingEdgeRatio,
            correlation_coefficient: latest.correlationCoefficient,
            is_phase_transition: latest.isPhaseTransition,
          }
        : null,
      regime: regime
        ? {
            regime: regime.regime,
            cdp_variance: regime.cdpVariance,
            correlation_consistency: regime.correlationConsistency,
            persistence_iterations: regime.persistenceIterations,
          }
        : null,
      trend: { mean: trend.mean, slope: trend.slope, window: trend.window },
      history_length: history.length,
    };
  }

  /* ─────────────── Gap Detection ─────────────── */

  /** Detect structural gaps between communities. */
  detectGaps(): GapSnapshot[] {
    const orch = this.#orchestrator;
    if (orch.tnaGraph.order === 0) return [];

    // Ensure communities and centrality are fresh
    orch.tnaLouvain.detect(42);
    orch.tnaCentrality.compute();

    const gaps: readonly GapMetrics[] = orch.tnaGapDetector.findGaps();
    return gaps.map((g) => ({
      community_a: g.communityA,
      community_b: g.communityB,
      density: g.interCommunityDensity,
      shortest_path: g.shortestPathLength,
      modularity_delta: g.modularityDelta,
      bridge_nodes: g.bridgeNodes.map(String),
    }));
  }

  /* ─────────────── Catalyst Questions ─────────────── */

  /** Generate bridging questions for gaps. */
  generateCatalystQuestions(gapId?: string): CatalystQuestionResult[] {
    const orch = this.#orchestrator;
    if (orch.tnaGraph.order === 0) return [];

    // Ensure gaps are computed
    orch.tnaLouvain.detect(42);
    orch.tnaCentrality.compute();
    const gaps = orch.tnaGapDetector.findGaps();

    if (gaps.length === 0) return [];

    // If gapId specified, filter to that gap
    const targetGaps = gapId
      ? gaps.filter((g) => `${g.communityA}_${g.communityB}` === gapId)
      : gaps;

    const results: CatalystQuestionResult[] = [];
    for (const gap of targetGaps) {
      const questions = orch.tnaCatalystGenerator.generateQuestions(gap);
      for (const q of questions) {
        results.push({
          gap_id: q.gapId,
          question_text: q.questionText,
          seed_node_a: q.seedNodeA,
          seed_node_b: q.seedNodeB,
          semantic_distance: q.semanticDistance,
          priority: q.priority,
        });
      }
    }
    return results;
  }

  /* ─────────────── Context Search ─────────────── */

  /** Semantic search across the LCM context store. */
  async searchContext(
    query: string,
    maxResults?: number,
  ): Promise<ContextSearchResult[]> {
    const grepResults = await this.#grep.grep(query, {
      maxResults: maxResults ?? 10,
      minSimilarity: 0.0,
    });
    return grepResults.map((r) => ({
      entry_id: r.entry.id,
      content: r.entry.content.slice(0, 500),
      similarity: r.similarity,
      timestamp: r.entry.timestamp,
    }));
  }

  /* ─────────────── Spawn Agent ─────────────── */

  /**
   * Spawn a new agent. Currently the VdW spawner is internally triggered
   * by obstruction events and not externally controllable.
   */
  spawnAgent(persona: string): {
    success: boolean;
    message: string;
    state: AgemStateSnapshot;
  } {
    return {
      success: false,
      message:
        `Agent spawning is currently triggered automatically by H¹ obstructions. ` +
        `Requested persona "${persona}" noted. Run more cycles to trigger VdW agent spawning.`,
      state: this.getState(),
    };
  }

  /* ─────────────── Reset ─────────────── */

  /** Reset the engine by tearing down and re-creating the Orchestrator. */
  async reset(): Promise<void> {
    await this.#orchestrator.shutdown();
    const embedder = new MockEmbedder();
    this.#orchestrator = new Orchestrator(embedder);
    this.#grep = this.#buildGrep(embedder);
  }

  /* ─────────────── Private Helpers ─────────────── */

  /**
   * Build a fresh LCMGrep instance.
   *
   * NOTE: The Orchestrator's internal LCMClient owns its own ImmutableStore.
   * We create a separate grep instance here for the bridge's context search.
   * Entries appended via the Orchestrator's LCMClient are NOT visible here.
   * For full integration, the Orchestrator should expose its internal store.
   * TODO: Wire into Orchestrator's LCMClient store once exposed.
   */
  #buildGrep(embedder: MockEmbedder): LCMGrep {
    const tokenCounter = new GptTokenCounter();
    const store = new ImmutableStore(tokenCounter);
    const cache = new EmbeddingCache(embedder);
    return new LCMGrep(store, cache, embedder);
  }
}

/** Singleton AGEM bridge. */
export const agemBridge = new AgemBridge();
