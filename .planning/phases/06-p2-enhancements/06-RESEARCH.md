# Phase 6 Research: P2 Enhancements

**Researched:** 2026-03-01
**Domain:** Advanced system features building on verified v1 core (Phase 5: 370 tests passing, all v1 requirements met)
**Confidence:** HIGH (based on 5 phases of reference implementation patterns, codebase analysis, and architectural understanding)

---

## Executive Summary

Phase 6 adds six advanced features to AGEM after the core mathematical properties have been validated end-to-end. Each feature has explicit trigger conditions (phase transition signals, structural gaps, regime stability changes) that emerge from the running system. Phase 6 is NOT a new integration phase; it extends existing modules (SOCTracker, GapDetector, ObstructionHandler) with new capabilities while maintaining strict module isolation.

**Key principle:** Phase 6 features are driven by **signals** (H1 obstruction magnitude, CDP trajectory, centrality time series) rather than hard-coded thresholds. All feature implementations reuse existing patterns from Phases 1-5 (rolling windows, event emission, metadata enrichment) rather than introducing new architectural concepts.

---

## SOC-06: Dynamic Phase Transition Detector (Cross-Correlation Sign Change)

### Current State (Phase 5)

SOCTracker already implements basic phase transition detection:
- Computes rolling Pearson correlation between `ΔS_structural` (Von Neumann entropy deltas) and `ΔS_semantic` (embedding entropy deltas)
- Detects sign change in correlation coefficient (indicates decoupling of structural and semantic complexity)
- Emits `phase:transition` event when correlation magnitude > 0.1 and sign changes

**Code location:** `/src/soc/SOCTracker.ts` lines 134-212 (phase transition detection logic)

### Phase 6 Enhancement: Regime Persistence Validation

The Phase 5 implementation detects **instantaneous** phase transitions. Phase 6 adds **regime validation**:

**What to implement:**
1. **Regime persistence tracking** — A phase transition candidate (sign change) must persist for N consecutive iterations before triggering a "confirmed" phase transition event
   - Default window: 3-5 iterations
   - Prevents noise-induced false positives from brief correlation fluctuations

2. **Regime stability metrics** — Beyond sign change, measure regime strength:
   - `regime_coherence`: How consistently does correlation maintain the same sign within a window?
   - Formula: `coherence = (count_same_sign_iterations / window_size)`
   - If `coherence < 0.6`, the regime is unstable; do not confirm transition

3. **H^1 magnitude validation** — Couple phase transition detection to Sheaf obstruction signal:
   - Only confirm a phase transition if **simultaneously** the H^1 dimension crosses a threshold (e.g., H^1 >= 2)
   - This validates that structural-semantic decoupling corresponds to topological obstruction

### Implementation Details

**File:** Extend `SOCTracker.ts` with new class `RegimeValidator`

```typescript
// Pseudocode (actual implementation follows existing pattern from SOCTracker)
interface RegimeState {
  transitionCandidate: boolean;
  confirmedAtIteration: number | null;
  coherence: number;
  previousSignChanges: number[]; // window of sign changes
}

class RegimeValidator {
  #regimes: Map<number, RegimeState> = new Map(); // phase number -> state

  validateTransition(correlationCoeff: number, previousCoeff: number, h1Dimension: number): boolean {
    // 1. Check sign change
    const signChanged = Math.sign(correlationCoeff) !== Math.sign(previousCoeff);

    // 2. Check H^1 magnitude threshold
    const h1Validated = h1Dimension >= 2;

    // 3. Track coherence across window
    const coherence = this.#computeCoherence();

    // 4. Confirm only if ALL three conditions hold
    return signChanged && h1Validated && coherence >= 0.6;
  }
}
```

**Integration point:** ObstructionHandler already subscribes to `'sheaf:h1-obstruction-detected'` events. Pass H^1 dimension to phase transition validation logic.

**Event output:** Emit new `phase:transition-confirmed` event (or extend `phase:transition` with `confirmed: boolean` field).

### Edge Cases & Validation

| Case | Handling |
|------|----------|
| Noisy correlation (frequent sign flips) | Require N consecutive same-sign iterations before confirming transition |
| H^1 spikes briefly above threshold | Require H^1 > threshold for window persistence, not just instantaneous spike |
| Multiple simultaneous transitions | Treat each as independent regime (tracked separately) |
| No transitions occur in 400+ iterations | Valid state; system remains in single regime (emit event documenting stability) |

---

## SOC-07: Regime Validation & Stability Metrics

### Current State

SOCTracker computes and emits `soc:metrics` every iteration with 8 fields including CDP, correlation coefficient, and `isPhaseTransition` flag. Metrics are logged to history but not analyzed for stability properties.

### Phase 6 Enhancement: Stability Analysis

**What to implement:**

1. **Regime stability classification**:
   ```typescript
   type RegimeStability = 'nascent' | 'stable' | 'critical' | 'transitioning';

   interface RegimeMetrics {
     regime: RegimeStability;
     cdpVariance: number;        // variance of CDP over last N iterations
     correlationConsistency: number; // std dev of correlation coefficient
     persistenceIterations: number;  // how long has system been in this regime?
     metrics: SOCMetrics[];       // snapshot of the current window
   }
   ```

2. **Regime persistence threshold**:
   - Nascent: < 5 iterations in new regime
   - Stable: 5-50 iterations; CDP variance < 0.2, correlation consistency < 0.3
   - Critical: CDP variance > 0.5 OR correlation swinging wildly (std dev > 0.8)
   - Transitioning: sign change in correlation just detected (transient state, 1-3 iterations)

3. **Metrics computation**:
   - CDP variance: `Var(CDP[-N:])` where N = window size (default: 10)
   - Correlation consistency: `StdDev(correlationCoeff[-N:])`
   - Persistence: iteration count since regime entry

### Implementation Details

**File:** New class in `SOCTracker.ts` or separate `/src/soc/RegimeAnalyzer.ts`

```typescript
// Pseudocode
class RegimeAnalyzer {
  #currentRegime: RegimeStability = 'nascent';
  #regimeStartIteration: number = 0;
  #metricsWindow: SOCMetrics[] = [];

  analyzeRegime(metrics: SOCMetrics): RegimeMetrics {
    this.#metricsWindow.push(metrics);
    if (this.#metricsWindow.length > this.#windowSize) {
      this.#metricsWindow.shift();
    }

    const cdpVariance = variance(this.#metricsWindow.map(m => m.cdp));
    const corrConsistency = stdDev(this.#metricsWindow.map(m => m.correlationCoefficient));
    const persistence = metrics.iteration - this.#regimeStartIteration;

    // Classify stability
    const regime = this.#classifyRegime(cdpVariance, corrConsistency, persistence);

    if (regime !== this.#currentRegime) {
      this.#currentRegime = regime;
      this.#regimeStartIteration = metrics.iteration;
    }

    return { regime, cdpVariance, correlationConsistency: corrConsistency, persistenceIterations: persistence, metrics: this.#metricsWindow };
  }
}
```

**Integration:**
- Instantiate RegimeAnalyzer in ObstructionHandler or ComposeRootModule
- Call `analyzeRegime()` after each `soc:metrics` event
- Emit new `regime:classification` event with RegimeMetrics payload

### Edge Cases

| Case | Handling |
|------|----------|
| CDP volatile but correlation stable | Classify as "transitioning" (structural flux but semantic coherence maintained) |
| Both CDP and correlation stable for 400+ iterations | Classify as "stable"; emit stability confirmation event |
| Single iteration with extreme CDP spike | Smooth with rolling median filter before computing variance |
| Regime never stabilizes in observation window | Valid; emit "critical" classification with full metrics for operator review |

---

## ORCH-06: Obstruction-Driven Topology Reconfiguration (H1 Signal → Van der Waals Agent Spawn)

### Current State (Phase 5)

ObstructionHandler subscribes to `'sheaf:h1-obstruction-detected'` events and spawns GapDetectorAgent instances to fill detected gaps. Agents are stubs with no parameterization; they do not spawn or configure based on the magnitude of the obstruction.

**Code location:** `/src/orchestrator/ObstructionHandler.ts` lines 115-300

### Phase 6 Enhancement: Parameterized Agent Spawning

**Concept: "Van der Waals agents"**

In the Molecular-CoT framework (Phase 3), bonds are classified:
- **Covalent:** Strong, cascade-invalidating
- **Hydrogen:** Moderate, similarity-threshold gated
- **Van der Waals:** Weak, temporary exploration probes

"Van der Waals agent" is a lightweight, ephemeral reasoning agent spawned for brief exploratory reasoning on low-confidence gaps. Spawn triggers:

**What to implement:**

1. **H^1-based spawn trigger parametrization**:
   ```typescript
   interface VdWSpawnParams {
     h1Dimension: number;           // from obstruction event
     gapCount: number;              // from GapDetector
     spanDensity: number;           // average inter-community density of gaps
     agentBudgetTokens: number;     // LLM context budget for this agent
     trajectoryMinLength: number;   // minimum trajectory length (5.0 from ORCH-03)
   }

   // Spawn logic:
   // - If H^1 >= 2 and gapCount >= 1: spawn 1 VdW agent per gap (up to N concurrent)
   // - If H^1 >= 5 and spanDensity < 0.15: spawn 2 agents per gap (high-confidence exploration)
   // - Agent lifetime: span 10-20 reasoning steps, then self-terminate
   // - Agent budget: scale inversely with H^1 (high obstruction = low budget = quick probes)
   ```

2. **Agent lifecycle coupling to regime state**:
   - Only spawn VdW agents during "transitioning" or "critical" regimes (SOC-07 output)
   - Suppress spawning during "stable" regimes (no need for exploration)
   - During "nascent" regimes, limit to single low-budget agent per gap

3. **Feedback loop to TNA graph**:
   - VdW agent generates synthetic bridging queries (via LLM inference in Phase 7+)
   - Queries are ingested back into CooccurrenceGraph via `ingestTokens()`
   - New nodes/edges are tagged with metadata: `generated_by: 'vdw_agent'`, `h1_threshold_triggered: number`

### Implementation Details

**File:** Extend `ObstructionHandler.ts` with `VdWAgentSpawner` class

```typescript
// Pseudocode
class VdWAgentSpawner {
  readonly #eventBus: EventBus;
  readonly #agentPool: AgentPool;
  readonly #regimeState: RegimeStability; // from SOC-07

  async spawnAgents(obstruction: SheafH1ObstructionEvent, regime: RegimeStability): Promise<void> {
    const { h1Dimension } = obstruction;
    const gaps = this.#gapDetector.findGaps();

    if (h1Dimension < 2 || gaps.length === 0) return; // no spawn condition met

    const agentCount = regime === 'critical' ? Math.min(gaps.length * 2, 10) : gaps.length;
    const tokenBudget = Math.max(500, 5000 / h1Dimension); // inverse scaling

    for (let i = 0; i < Math.min(agentCount, 10); i++) {
      const gap = gaps[i % gaps.length]!;
      const agent = new VdWAgent(this.#generateAgentId(), {
        targetGap: gap,
        tokenBudget,
        maxIterations: 15,
        h1Threshold: h1Dimension,
      });

      await this.#agentPool.add(agent);
      this.#eventBus.emit({
        type: 'orch:vdw-agent-spawned',
        agentId: agent.id,
        h1Dimension,
        gapId: gap.communityA + '_' + gap.communityB,
      });
    }
  }
}
```

**Integration points:**
- ObstructionHandler calls `spawnAgents()` when H^1 obstruction detected
- Pass both obstruction event AND current regime state (from SOC-07)
- VdW agent runs self-contained reasoning loop (10-20 iterations max)
- Agent emits results via `orch:vdw-agent-complete` event with synthetic queries and new graph entities

### Edge Cases & Validation

| Case | Handling |
|------|----------|
| H^1 oscillates between 1 and 3 (boundary crossing) | Require hysteresis: spawn agents only when H^1 >= 2 for 2+ consecutive iterations |
| Gap detected but has no bridge candidates | Spawn agent with reduced budget (500 tokens max) for speculative bridging |
| Multiple agents spawned simultaneously | Queue them; run serially to avoid graph mutation race conditions |
| VdW agent produces no synthetic queries (LLM failure) | Mark agent as failed; decrement spawn budget for next iteration; do not retry same gap |
| Agent trajectory length < 5.0 (from ORCH-03 Van der Waals invariant) | Reject agent output; classify as non-compliant with bond type rules |

---

## TNA-07: GraphRAG Catalyst Question Generation at Structural Gaps

### Current State

GapDetector identifies structural gaps (low-density inter-community regions) with metrics: density, shortest path length, modularity delta, bridge nodes. Gaps are used reactively by ObstructionHandler to spawn exploration agents. No generative question mechanism exists.

**Code location:** `/src/tna/GapDetector.ts`

### Phase 6 Enhancement: Catalyst Question Generation

**Concept: "Catalyst questions" are LLM-generated queries that probe the semantic space between two communities, designed to uncover bridging concepts.**

GraphRAG (Graph Retrieval-Augmented Generation) is a technique combining graph topology with LLM reasoning. For AGEM:

**What to implement:**

1. **Structural gap analysis**:
   - For each gap (communityA, communityB):
     - Extract representative nodes from each community (top 3-5 by betweenness centrality within community)
     - Retrieve their textual definitions/embeddings from LCM context store
     - Compute semantic distance: `1 - cosine_similarity(centroid_A, centroid_B)`
   - Higher distance = larger semantic void

2. **Catalyst question templates**:
   ```typescript
   interface CatalystQuestion {
     gap: GapMetrics;
     template: string;           // "How does [concept_A] relate to [concept_B]?"
     seedNodes: [string, string]; // [concept_from_commA, concept_from_commB]
     semanticDistance: number;   // 0-1; 1 = maximum void
     priority: number;           // for agent reasoning order
   }

   // Example generation:
   // Gap: {communityA: 2, communityB: 5, bridgeNodes: ['enzyme', 'substrate']}
   // Communities contain: A = {protein, binding, active_site}, B = {reaction, rate, catalyst}
   // Generated question: "How do enzymatic binding sites influence reaction catalysis rates?"
   ```

3. **Integration with GapDetector**:
   - Extend GapMetrics output with `catalystQuestions: CatalystQuestion[]`
   - Call LLM (via llm_map) to generate 1-3 questions per gap
   - Cache results in LCM ImmutableStore for reuse

### Implementation Details

**File:** New class `/src/tna/CatalystQuestionGenerator.ts`

```typescript
// Pseudocode
class CatalystQuestionGenerator {
  readonly #cooccurrenceGraph: CooccurrenceGraph;
  readonly #lcmClient: LCMClient;
  readonly #llmMap: typeof llm_map; // from orchestrator

  async generateCatalystQuestions(gap: GapMetrics): Promise<CatalystQuestion[]> {
    // 1. Extract representative nodes
    const nodesA = this.#getRepresentativeNodes(gap.communityA, 3);
    const nodesB = this.#getRepresentativeNodes(gap.communityB, 3);

    // 2. Compute semantic distance
    const distance = this.#computeSemanticDistance(nodesA, nodesB);

    // 3. Build LLM prompts
    const prompt = this.#buildPrompt(nodesA, nodesB, distance);

    // 4. Call LLM via llm_map (parallel if multiple gaps)
    const result = await this.#llmClient.generate(prompt, { maxTokens: 200 });

    // 5. Parse and structure questions
    const questions = this.#parseQuestions(result, gap, nodesA[0], nodesB[0]);

    // 6. Store in LCM for reuse
    await this.#lcmClient.append({
      type: 'catalyst_question',
      gapId: gap.communityA + '_' + gap.communityB,
      questions,
      timestamp: Date.now(),
    });

    return questions;
  }

  #getRepresentativeNodes(communityId: number, count: number): string[] {
    // Get top betweenness centrality nodes in community
    return this.#cooccurrenceGraph
      .getNodes()
      .filter(n => n.communityId === communityId)
      .sort((a, b) => (b.betweennessCentrality ?? 0) - (a.betweennessCentrality ?? 0))
      .slice(0, count)
      .map(n => n.lemma);
  }
}
```

**Integration:**
- Call CatalystQuestionGenerator from ObstructionHandler when spawning VdW agents
- Pass questions to agent as reasoning priors (update agent context via llm_map)
- Track question-to-answer mappings in LCM for feedback

### Edge Cases

| Case | Handling |
|------|----------|
| Community has < 3 nodes | Use all available nodes as representative set |
| Semantic distance is 0 (fully redundant communities) | Generate "reconciliation" questions instead ("How do these two perspectives align?") |
| LLM fails to generate questions | Return empty array; mark gap as "pending LLM retry"; do not block agent spawn |
| Generated question is generic or uninformative | Filter via embedding similarity: new question must be > 0.3 away from community labels to be retained |
| Gap disappears in next iteration (communities merged) | Mark cached questions as stale; do not reuse without revalidation |

---

## TNA-08: Force-Atlas Layout for Semantic Graph Visualization

### Current State

CooccurrenceGraph stores topology (nodes, edges, weights, community assignments) in graphology. No visualization or layout is computed. Graph structure is accessible for analysis but not visually rendered.

### Phase 6 Enhancement: Force-Directed Layout with Physics Simulation

**Concept: Force-Atlas is a force-directed graph layout algorithm that positions nodes such that:**
- Similar nodes (short edges, same community) cluster together
- Dissimilar nodes (long edges, different communities) repel
- Layout emerges from spring-physics simulation (attractive edge forces, repulsive node forces)

**What to implement:**

1. **Force-Atlas implementation or library integration**:
   - **Option A (recommended):** Use `graphology-layout-forceatlas2` (JavaScript implementation of the ForceAtlas2 algorithm)
   - **Option B:** Integrate `sigma.js` (graph visualization library with built-in Force-Atlas)
   - **Option C:** Custom physics engine (higher effort, more control)

2. **Layout computation integration**:
   ```typescript
   interface NodePosition {
     x: number;
     y: number;
   }

   interface LayoutOutput {
     positions: Map<string, NodePosition>;  // nodeId -> {x, y}
     energy: number;                         // convergence metric
     iterations: number;                     // physics steps executed
   }

   class ForceAtlasLayout {
     compute(graph: CooccurrenceGraph, config?: LayoutConfig): LayoutOutput {
       // Run physics simulation
       // Return node positions for rendering
     }
   }
   ```

3. **Integration with TNA pipeline**:
   - Call layout computation after Louvain community detection
   - Cache positions in CooccurrenceGraph node metadata
   - Re-compute incrementally when new nodes/edges added (only 1-2 iterations to adjust)

4. **Visualization output**:
   - Export layout as JSON: `{ nodes: [...], edges: [...], positions: {...} }`
   - Compatible with D3.js, Sigma.js, or custom web visualization
   - Include community assignment colors for visual cluster validation

### Implementation Details

**File:** New class `/src/tna/LayoutComputer.ts`

```typescript
// Pseudocode
import ForceAtlas2 from 'graphology-layout-forceatlas2';

class LayoutComputer {
  readonly #cooccurrenceGraph: CooccurrenceGraph;

  computeLayout(iterations: number = 100): LayoutOutput {
    const graph = this.#cooccurrenceGraph.getGraph();

    // Configure physics parameters
    const config = {
      iterations,
      barnesHutOptimize: true,        // O(n log n) instead of O(n^2)
      linLogMode: false,              // spring-based, not log-based
      strongGravityMode: false,       // weaker gravity pulls towards center
      gravity: 1.0,
      slowDown: 1.0,
      edgeWeightInfluence: 1.0,       // respect edge weights from 4-gram window
      scalingRatio: 2.0,              // relative strength of repulsion
      theta: 0.5,                     // Barnes-Hut accuracy (0.5-1.0)
    };

    // Run simulation
    const positions = ForceAtlas2(graph, { iterations: config.iterations, ...config });

    // Compute convergence energy
    const energy = this.#computeEnergy(graph, positions);

    // Cache positions back to CooccurrenceGraph metadata
    for (const [nodeId, pos] of Object.entries(positions)) {
      this.#cooccurrenceGraph.updateNodePosition(nodeId, pos);
    }

    return { positions: new Map(Object.entries(positions)), energy, iterations };
  }

  #computeEnergy(graph: any, positions: Record<string, [number, number]>): number {
    // Sum of squared forces across all nodes (convergence indicator)
    let energy = 0;
    // ... compute total kinetic energy of system
    return energy;
  }
}
```

**Integration:**
- Call `computeLayout()` after every 10-20 iterations of the main reasoning loop
- Emit `tna:layout-updated` event with LayoutOutput for visualization consumers
- Store layout in LCM for checkpoint/recovery

### Edge Cases

| Case | Handling |
|------|----------|
| Graph has < 3 nodes | Skip layout (not meaningful); return single-node trivial layout |
| Graph is fully disconnected (no edges) | All nodes repel equally; layout spreads across space (valid but semantically flat) |
| New nodes added mid-simulation | Restart layout with N/2 iterations to integrate newcomers without full recompute |
| Layout diverges (energy growing) | Reduce scaling ratio; restart with tuned parameters |
| Two communities perfectly overlap in layout | Valid output (indicates high semantic similarity); document in metadata |

**Library selection rationale:**
- `graphology-layout-forceatlas2`: No external dependencies beyond graphology (already used); pure JS; configurable physics
- `sigma.js`: Higher-level abstraction; includes rendering; adds complexity for visualization-only task
- Custom physics: Overkill for Phase 6 (can defer to Phase 7+ optimization phase)

**Recommendation:** Use `graphology-layout-forceatlas2` for Phase 6. Visualization (rendering to canvas/SVG) is a consumer concern (Phase 7+), not core to AGEM engine.

---

## TNA-09: Betweenness Centrality Tracking Over Time

### Current State (Phase 3)

CentralityAnalyzer computes normalized betweenness centrality for all nodes in a single pass (after community detection). Values are cached in TextNode metadata. Centrality is static per iteration: computed once, stored, used for gap detection and bridge identification.

**Code location:** `/src/tna/CentralityAnalyzer.ts`

### Phase 6 Enhancement: Time-Series Centrality Analysis

**Concept: Track how node centrality (bridge importance) evolves over iterations as the graph grows and communities shift.**

**What to implement:**

1. **Centrality time series**:
   ```typescript
   interface CentralityTimeSeries {
     nodeId: string;
     scores: Array<{ iteration: number; score: number }>;
     trend: 'rising' | 'falling' | 'stable' | 'oscillating';
     peak: { iteration: number; score: number };
     valley: { iteration: number; score: number };
   }
   ```

2. **Dynamic centrality computation**:
   - Recompute centrality every 10-20 iterations (not every iteration; expensive O(n^2))
   - Track deltas: `Δc_i = c_i(t+1) - c_i(t)`
   - Identify nodes with rising centrality (becoming more bridge-like) vs. falling (becoming internal)
   - Flag rapid centrality changes (from 0.1 to 0.7 in 2 iterations = emerging bridge)

3. **Integration with gap detection**:
   - Prioritize newly-central nodes for bridging queries (TNA-07)
   - If a node's centrality rose 3x in recent window, query about its role
   - Example: "Enzyme centrality rose from 0.1 to 0.35. What new bridging role did it acquire?"

4. **Regime coupling**:
   - During "transitioning" or "critical" regimes (SOC-07), track centrality more closely (compute every 5 iterations instead of 10)
   - During "stable" regimes, revert to 20-iteration sampling (avoid noise)

### Implementation Details

**File:** Extend `CentralityAnalyzer.ts` or new `/src/tna/CentralityTimeSeries.ts`

```typescript
// Pseudocode
class CentralityTimeSeriesTracker {
  readonly #cooccurrenceGraph: CooccurrenceGraph;
  readonly #timeSeries: Map<string, CentralityTimeSeries> = new Map();
  #lastComputationIteration: number = 0;
  #computationInterval: number = 10; // iterations between recomputes

  updateCentrality(currentIteration: number, regime: RegimeStability): void {
    // 1. Determine if recomputation is needed
    const shouldRecompute = currentIteration - this.#lastComputationIteration >= this.#computationInterval;
    if (!shouldRecompute) return;

    // 2. Adjust interval based on regime
    if (regime === 'transitioning' || regime === 'critical') {
      this.#computationInterval = 5;
    } else if (regime === 'stable') {
      this.#computationInterval = 20;
    }

    // 3. Recompute centrality
    const centralityAnalyzer = new CentralityAnalyzer(this.#cooccurrenceGraph);
    const scores = centralityAnalyzer.compute();

    // 4. Update time series
    for (const [nodeId, score] of scores) {
      const series = this.#timeSeries.get(nodeId) ?? { nodeId, scores: [], trend: 'stable', peak: null, valley: null };
      series.scores.push({ iteration: currentIteration, score });

      // Compute trend
      series.trend = this.#computeTrend(series.scores);
      series.peak = this.#findPeak(series.scores);
      series.valley = this.#findValley(series.scores);

      this.#timeSeries.set(nodeId, series);
    }

    this.#lastComputationIteration = currentIteration;
  }

  #computeTrend(scores: Array<{ iteration: number; score: number }>): 'rising' | 'falling' | 'stable' | 'oscillating' {
    if (scores.length < 3) return 'stable';

    const recent = scores.slice(-3);
    const slope = (recent[2]!.score - recent[0]!.score) / 2;

    if (Math.abs(slope) < 0.05) return 'stable';
    if (slope > 0.1) return 'rising';
    if (slope < -0.1) return 'falling';
    return 'oscillating';
  }

  #findPeak(scores: Array<{ iteration: number; score: number }>): any {
    return scores.reduce((max, curr) => (curr.score > max.score ? curr : max), scores[0]);
  }

  #findValley(scores: Array<{ iteration: number; score: number }>): any {
    return scores.reduce((min, curr) => (curr.score < min.score ? curr : min), scores[0]);
  }
}
```

**Integration:**
- Instantiate CentralityTimeSeriesTracker in ComposeRootModule
- Call `updateCentrality()` each iteration (checks internally if recompute is needed)
- Emit `tna:centrality-change-detected` event when rapid changes observed
- Use rising-centrality nodes for priority questioning in TNA-07

### Edge Cases

| Case | Handling |
|------|----------|
| Node appears in iteration 50, has no prior history | Initialize trend as 'nascent' (special marker); do not include in rising/falling comparisons until 3 data points |
| Node disappears (removed from graph) | Mark as 'retired'; exclude from future trend computation |
| Centrality spike due to temporary high-degree node | Smooth time series with moving median (window size 3) before computing trend |
| All nodes equally central (flat distribution) | Valid; trend = 'stable' for all nodes (document as "undifferentiated topology") |
| Two nodes swap centrality ranks (0.8 → 0.1 and 0.1 → 0.8) | Detect as major structural shift; emit `tna:topology-reorganized` event for operator awareness |

---

## Key Dependencies & Integration Points

### Cross-Feature Dependencies

```
SOC-06 (Phase Transition Detector)
  ├─ reads: SOCTracker.history (CDP, correlation)
  ├─ reads: H1 dimension from EventBus
  └─ emits: phase:transition-confirmed → ObstructionHandler, SOC-07

SOC-07 (Regime Validation)
  ├─ reads: SOCTracker metrics + SOC-06 transition status
  ├─ emits: regime:classification → ORCH-06, TNA-09
  └─ feeds: regime state to decision logic

ORCH-06 (VdW Agent Spawning)
  ├─ triggered: by sheaf:h1-obstruction-detected AND regime:classification
  ├─ reads: GapDetector output, SOC-07 regime
  ├─ calls: TNA-07 (catalyst question generation)
  ├─ calls: llm_map (parallel agent reasoning)
  └─ emits: orch:vdw-agent-spawned, orch:vdw-agent-complete

TNA-07 (Catalyst Questions)
  ├─ triggered: by ORCH-06 agent spawn
  ├─ reads: GapMetrics + CooccurrenceGraph topology
  ├─ reads: LCM context for semantic embeddings
  ├─ calls: CentralityAnalyzer for representative nodes
  ├─ calls: LLM via llm_map
  └─ emits: tna:catalyst-questions-generated

TNA-08 (Force-Atlas Layout)
  ├─ reads: CooccurrenceGraph topology + community assignments
  ├─ runs: after LouvainDetector every 10-20 iterations
  ├─ reads: TNA-09 centrality for node sizing
  └─ emits: tna:layout-updated

TNA-09 (Centrality Time Series)
  ├─ triggered: periodically (every 5-20 iterations, regime-dependent)
  ├─ reads: current CooccurrenceGraph
  ├─ reads: SOC-07 regime state (to adjust frequency)
  ├─ triggers: TNA-07 when rapid centrality rise detected
  └─ emits: tna:centrality-change-detected
```

### Event Bus Integration

New Phase 6 events (all extend existing `AnyEvent` discriminated union in `src/types/Events.ts`):

| Event Type | Emitter | Subscribers | Payload |
|------------|---------|-------------|---------|
| `phase:transition-confirmed` | SOC-06 | ORCH-06, Logging | `{ iteration, centeredAtIteration, coherence, h1Dimension }` |
| `regime:classification` | SOC-07 | ORCH-06, TNA-09, Logging | `{ regime, cdpVariance, persistenceIterations, metrics }` |
| `orch:vdw-agent-spawned` | ORCH-06 | Logging, Monitoring | `{ agentId, h1Dimension, gapId, tokenBudget }` |
| `orch:vdw-agent-complete` | ORCH-06 | TNA (graph update), Logging | `{ agentId, synthQueries, entitiesAdded, relationsAdded }` |
| `tna:catalyst-questions-generated` | TNA-07 | ORCH-06 (feeds to agents) | `{ gapId, questions, semanticDistance }` |
| `tna:layout-updated` | TNA-08 | Visualization consumers | `{ positions, energy, iterations }` |
| `tna:centrality-change-detected` | TNA-09 | TNA-07 (priority), Logging | `{ nodeId, trend, deltaScore, iteration }` |
| `tna:topology-reorganized` | TNA-09 | Logging, Operator alerts | `{ majorNodeSwaps, timestamp }` |

---

## Implementation Strategy Recommendations

### Execution Order (Waves)

**Wave 1: Metrics & Stability (2-3 days)**
1. SOC-06: Extend SOCTracker with `RegimeValidator` (rolling persistence check)
2. SOC-07: Implement `RegimeAnalyzer` class (stability classification)
3. Integrate: Update EventBus with new event types; wire to ComposeRootModule

**Wave 2: Obstruction Coupling (2-3 days)**
1. ORCH-06: Implement `VdWAgentSpawner` in ObstructionHandler
2. Parameterize: Agent spawn decisions based on H^1 magnitude + regime state
3. Testing: Unit tests for spawn trigger logic; integration with GapDetector

**Wave 3: Semantic Bridging (3-4 days)**
1. TNA-07: Implement `CatalystQuestionGenerator` with graph analysis
2. LLM integration: Call llm_map for question generation; cache in LCM
3. Testing: Unit tests with synthetic gaps; integration with VdW agents

**Wave 4: Visualization & Tracking (2-3 days)**
1. TNA-08: Integrate graphology-layout-forceatlas2; expose layout JSON
2. TNA-09: Implement `CentralityTimeSeriesTracker`; couple to regime state
3. Integration: Wire time series to TNA-07 for priority questioning

**Total estimate: 10-15 days of focused development + testing**

### Blockers & Mitigations

| Blocker | Mitigation | Owner |
|---------|-----------|-------|
| LLM inference availability (for TNA-07) | Implement synthetic question template fallback (no LLM call); stubs for Phase 6 planning | TNA-07 |
| H^1 dimension oscillation (frequent spawn/suppress cycles) | Implement 2-iteration hysteresis (require sustained H^1 >= 2); smooth via exponential moving average | ORCH-06 |
| Force-Atlas convergence (non-deterministic layout) | Use fixed random seed in physics simulation; document layout is advisory (not required for correctness) | TNA-08 |
| Centrality recomputation cost (O(n^2) for 400+ node graph) | Cache previous centrality; compute deltas incrementally (10-iteration sampling); use graphology-metrics built-in optimizations | TNA-09 |

### Trade-offs & Deferral

**In-scope for Phase 6:**
- Dynamic phase transition detection with regime persistence
- H^1-parameterized agent spawn logic
- Structural gap question generation framework
- Force-directed layout computation
- Centrality trend analysis

**Out-of-scope (defer to Phase 7+):**
- Web UI visualization (layout + graph rendering)
- Advanced LLM prompting strategies (multi-turn dialogue with agents)
- Centrality prediction (forecasting future bridge importance)
- Layout persistence (checkpoint/recover layout state)
- Optimization of force-atlas parameters per community structure

---

## Success Criteria (Preliminary)

These will be finalized during Phase 5 retrospective based on empirical system behavior:

1. **SOC-06**: Phase transition detector fires within 1-3 iterations of actual regime change (validated by manual inspection of 400-iteration runs with known transitions)

2. **SOC-07**: Regime classification changes at most 2-3 times in a 400-iteration run; "stable" regimes persist for 50+ iterations on average

3. **ORCH-06**: VdW agents spawn when H^1 >= 2 and persist until iteration limit; no spawn during stable regimes

4. **TNA-07**: Catalyst questions generated for >= 70% of detected gaps; questions are semantically distinct from community labels (embedding distance > 0.3)

5. **TNA-08**: Layout converges within 100 iterations with energy < 1.0 (typical range: 0.1-0.5); communities visually cluster in final layout

6. **TNA-09**: Centrality time series computed every 10-20 iterations; rising/falling trends detected within 2-3 data points (6-9 iterations); peak/valley identified correctly

7. **Integration**: All Phase 6 events emitted correctly; no cross-component coupling violations (isolation.test.ts still passes)

---

## RESEARCH COMPLETE

**Next step:** Proceed to Phase 6 Planning (06-PLAN.md) to convert these research findings into detailed implementation tasks, test specifications, and acceptance criteria.

---

*Research completed: 2026-03-01*
*Confidence level: HIGH*
*Based on: Phase 5 reference implementation (370 tests, all v1 requirements met), codebase patterns analysis, architectural review*
