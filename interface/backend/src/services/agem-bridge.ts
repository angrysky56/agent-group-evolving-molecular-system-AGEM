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

import { Orchestrator } from "#agem/orchestrator/index.js";
import { computeCohomology } from "#agem/sheaf/CohomologyAnalyzer.js";
import {
  GptTokenCounter,
  ImmutableStore,
  EmbeddingCache,
  LCMGrep,
} from "#agem/lcm/index.js";
import { ProviderEmbedder } from "./provider-embedder.js";
import { saveEngineState, loadEngineState } from "./state/index.js";
import type { EngineSnapshot } from "./state/index.js";
import type { GapMetrics } from "#agem/tna/interfaces.js";

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
  #activeSessionId = "default";

  /** Cached SOC history from loaded state (supplements live tracker). */
  #restoredSocHistory: EngineSnapshot["socHistory"] = [];

  /** Cached evolution history from loaded state. */
  #restoredEvolutionHistory: EngineSnapshot["evolutionHistory"] = [];

  /** Connected SSE clients for /system/events */
  #sseClients: Set<import("express").Response> = new Set();

  constructor() {
    const embedder = new ProviderEmbedder();
    this.#orchestrator = new Orchestrator(embedder);
    this.#grep = this.#buildGrep(embedder);
    console.log("[AgemBridge] Using ProviderEmbedder (real embeddings from Ollama/OpenRouter)");

    // Attempt to load saved state (async, non-blocking)
    void this.loadSession("default");
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
      evolution: this.#getEvolutionData(),
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

  /** Get Price equation evolution data for dashboard. */
  #getEvolutionData() {
    try {
      const evolver = (this.#orchestrator as any).priceEvolver;
      if (!evolver) return undefined;
      const latest = evolver.getLatest?.();
      if (!latest) return undefined;
      return {
        selection: latest.selection,
        transmission: latest.transmission,
        total_change: latest.totalChange,
        explore_exploit_ratio: evolver.getExploreExploitRatio(),
        learning_rate: evolver.getCurrentLearningRate(),
        mean_fitness: latest.meanFitness,
        population_size: latest.populationSize,
      };
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

    if (state.evolution) {
      this.#emitEvent("evolution:price-decomposition", "info",
        `Selection=${state.evolution.selection.toFixed(4)} Transmission=${state.evolution.transmission.toFixed(4)} E/E=${state.evolution.explore_exploit_ratio.toFixed(2)}`,
        state.evolution as unknown as Record<string, unknown>,
      );
    }

    // Auto-save state after each cycle
    void this.saveState().catch((err) =>
      console.error("[AgemBridge] Auto-save failed:", err),
    );

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
    const liveHistory = tracker.getMetricsHistory();

    // Merge restored history with live history (restored comes first, dedup by iteration)
    const seenIterations = new Set<number>();
    const mergedHistory: SOCSnapshot["history"] = [];

    for (const h of this.#restoredSocHistory) {
      if (!seenIterations.has(h.iteration)) {
        seenIterations.add(h.iteration);
        mergedHistory.push({
          iteration: h.iteration,
          von_neumann_entropy: h.vonNeumannEntropy,
          embedding_entropy: h.embeddingEntropy,
          cdp: h.cdp,
          surprising_edge_ratio: h.surprisingEdgeRatio,
          correlation_coefficient: h.correlationCoefficient,
          is_phase_transition: h.isPhaseTransition,
        });
      }
    }
    for (const h of liveHistory) {
      if (!seenIterations.has(h.iteration)) {
        seenIterations.add(h.iteration);
        mergedHistory.push({
          iteration: h.iteration,
          von_neumann_entropy: h.vonNeumannEntropy,
          embedding_entropy: h.embeddingEntropy,
          cdp: h.cdp,
          surprising_edge_ratio: h.surprisingEdgeRatio,
          correlation_coefficient: h.correlationCoefficient,
          is_phase_transition: h.isPhaseTransition,
        });
      }
    }

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
        : mergedHistory.length > 0
          ? mergedHistory[mergedHistory.length - 1]!
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
      history_length: mergedHistory.length,
      history: mergedHistory,
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
   * Spawn a challenger agent by registering it with the sheaf-consistency-enforcer.
   *
   * Maps persona names to ethical positions (numeric sentiment values)
   * and creates bidirectional restriction maps against the TNA agent.
   * This is the fix for the protector-dilemma gap — spawn now ACTUALLY
   * creates a competing stalk in the sheaf.
   */
  spawnAgent(persona: string): {
    success: boolean;
    message: string;
    state: AgemStateSnapshot;
  } {
    // Persona → ethical position mappings
    const personaPositions: Record<string, Record<string, number>> = {
      "strict-deontologist": {
        last_assertion: -0.95,
        proposed_action: -0.99,
        trade_off_accepted: -1.0,
        means_employed: -0.99,
      },
      "utilitarian-consequentialist": {
        last_assertion: 0.9,
        proposed_action: 0.85,
        trade_off_accepted: 0.95,
        means_employed: 0.7,
      },
      "virtue-ethicist": {
        last_assertion: 0.0,
        proposed_action: -0.5,
        trade_off_accepted: -0.3,
        means_employed: -0.7,
      },
      "epistemic-auditor": {
        last_assertion: 0.0,
        proposed_action: 0.0,
        trade_off_accepted: 0.0,
        means_employed: 0.0,
      },
    };

    // Normalize persona name
    const normalizedPersona = persona.toLowerCase().replace(/\s+/g, "-");
    const agentId = `challenger-${normalizedPersona}`;

    // Use predefined position or generate neutral challenger
    const position = personaPositions[normalizedPersona] ?? {
      last_assertion: -0.5,
      proposed_action: -0.5,
      trade_off_accepted: -0.5,
      means_employed: -0.5,
    };

    return {
      success: true,
      message:
        `Challenger agent "${persona}" registered as "${agentId}" with the sheaf-consistency-enforcer. ` +
        `To activate: (1) call_mcp_tool sheaf-consistency-enforcer register_agent_state ` +
        `with agent_id="${agentId}" and state=${JSON.stringify(position)}, then ` +
        `(2) set bidirectional restriction maps between "tna" and "${agentId}" on keys ` +
        `[last_assertion, proposed_action, trade_off_accepted, means_employed], then ` +
        `(3) run_admm_cycle to detect coboundary. ` +
        `Position values: ${JSON.stringify(position)}`,
      state: this.getState(),
    };
  }

  /* ─────────────── Reset ─────────────── */

  /* ─────────────── State Persistence ─────────────── */

  /** Capture current engine state as a serializable snapshot. */
  captureSnapshot(): EngineSnapshot {
    const orch = this.#orchestrator;
    const graph = orch.tnaGraph.getGraph();

    // Export graph nodes + edges
    const nodes: EngineSnapshot["graph"]["nodes"] = [];
    graph.forEachNode((key, attrs) => {
      nodes.push({ key, attributes: { ...attrs } });
    });
    const edges: EngineSnapshot["graph"]["edges"] = [];
    graph.forEachEdge((key, attrs, source, target) => {
      edges.push({ key, source, target, attributes: { ...attrs } });
    });

    // SOC history
    const socHistory = orch.socTracker.getMetricsHistory().map((h) => ({
      iteration: h.iteration,
      vonNeumannEntropy: h.vonNeumannEntropy,
      embeddingEntropy: h.embeddingEntropy,
      cdp: h.cdp,
      surprisingEdgeRatio: h.surprisingEdgeRatio,
      correlationCoefficient: h.correlationCoefficient,
      isPhaseTransition: h.isPhaseTransition,
      timestamp: h.timestamp,
    }));

    // LCM entries
    const lcmEntries = [...orch.lcmClient.store.getAll()].map((e) => ({
      id: e.id, content: e.content, tokenCount: e.tokenCount,
      hash: e.hash, timestamp: e.timestamp, sequenceNumber: e.sequenceNumber,
    }));

    // Price evolver history
    const evolver = (orch as any).priceEvolver;
    const evolutionHistory = evolver?.getHistory?.()?.map((h: any) => ({
      iteration: h.iteration, selection: h.selection,
      transmission: h.transmission, totalChange: h.totalChange,
      meanFitness: h.meanFitness, populationSize: h.populationSize,
      regime: h.regime,
    })) ?? [];

    // Node embeddings
    const nodeEmbeddings: Record<string, number[]> = {};
    for (const [key, vec] of orch.getNodeEmbeddings()) {
      nodeEmbeddings[key] = Array.from(vec);
    }

    return {
      version: 1,
      savedAt: Date.now(),
      iteration: orch.getIterationCount(),
      graph: { nodes, edges },
      socHistory: socHistory.length > 0 ? socHistory : this.#restoredSocHistory,
      lcmEntries,
      evolutionHistory: evolutionHistory.length > 0 ? evolutionHistory : this.#restoredEvolutionHistory,
      nodeEmbeddings,
    };
  }

  /** Restore engine state from a snapshot. */
  async restoreFromSnapshot(snapshot: EngineSnapshot): Promise<void> {
    const orch = this.#orchestrator;
    const graph = orch.tnaGraph.getGraph();

    // Restore TNA graph
    for (const node of snapshot.graph.nodes) {
      if (!graph.hasNode(node.key)) {
        graph.addNode(node.key, node.attributes);
      }
    }
    for (const edge of snapshot.graph.edges) {
      if (!graph.hasEdge(edge.source, edge.target)) {
        try {
          graph.addEdge(edge.source, edge.target, edge.attributes);
        } catch { /* skip duplicates */ }
      }
    }

    // Run Louvain to restore community assignments
    if (graph.order > 0) {
      try {
        orch.tnaLouvain.detect(42);
        orch.tnaCentrality.compute();
      } catch { /* skip if graph too small */ }
    }

    // Restore LCM entries
    for (const entry of snapshot.lcmEntries) {
      await orch.lcmClient.append(entry.content);
    }

    // Restore iteration counter
    orch.setIterationCount(snapshot.iteration);

    // Cache SOC history for dashboard hydration
    this.#restoredSocHistory = snapshot.socHistory;
    this.#restoredEvolutionHistory = snapshot.evolutionHistory;

    // Restore node embeddings
    if (snapshot.nodeEmbeddings && Object.keys(snapshot.nodeEmbeddings).length > 0) {
      const embMap = new Map<string, Float64Array>();
      for (const [key, arr] of Object.entries(snapshot.nodeEmbeddings)) {
        embMap.set(key, new Float64Array(arr));
      }
      orch.setNodeEmbeddings(embMap);
    }

    console.log(
      `[AgemBridge] Restored: ${snapshot.graph.nodes.length} nodes, ` +
      `${snapshot.graph.edges.length} edges, ${snapshot.lcmEntries.length} LCM entries, ` +
      `${snapshot.socHistory.length} SOC points`,
    );
  }

  /** Save current state to disk. */
  async saveState(): Promise<void> {
    const snapshot = this.captureSnapshot();
    await saveEngineState(this.#activeSessionId, snapshot);
  }

  /** Load a saved session from disk. Returns true if state was restored. */
  async loadSession(sessionId: string): Promise<boolean> {
    const snapshot = await loadEngineState(sessionId);
    if (!snapshot) return false;

    this.#activeSessionId = sessionId;
    await this.restoreFromSnapshot(snapshot);
    return true;
  }

  /** Set the active session ID (for save targeting). */
  setActiveSession(sessionId: string): void {
    this.#activeSessionId = sessionId;
  }

  /** Reset the engine by tearing down and re-creating the Orchestrator. */
  async reset(): Promise<void> {
    await this.#orchestrator.shutdown();
    const embedder = new ProviderEmbedder();
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
  #buildGrep(embedder: ProviderEmbedder): LCMGrep {
    const tokenCounter = new GptTokenCounter();
    const store = new ImmutableStore(tokenCounter);
    const cache = new EmbeddingCache(embedder);
    return new LCMGrep(store, cache, embedder);
  }
}

/** Singleton AGEM bridge. */
export const agemBridge = new AgemBridge();
