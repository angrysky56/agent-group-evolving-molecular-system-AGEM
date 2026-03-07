# Architecture Research

**Domain:** Multi-agent AI system — RLM-LCM Molecular-CoT framework (TypeScript/JavaScript reference implementation)
**Researched:** 2026-02-27
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Orchestration Layer                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  AGEMOrchestrator — agent lifecycle, session management,   │  │
│  │  iteration loop, phase-transition detection, llm_map coord  │  │
│  └────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                       Core Component Layer                       │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────┐  │
│  │    LCM      │  │   Sheaf     │  │   TNA    │  │   SOC    │  │
│  │  (Memory)   │  │  (Coord)    │  │(Semantic)│  │(Metrics) │  │
│  └──────┬──────┘  └──────┬──────┘  └─────┬────┘  └─────┬────┘  │
│         │                │               │              │        │
├─────────┴────────────────┴───────────────┴──────────────┴───────┤
│                    Shared Interfaces / Event Bus                  │
│  ContextEvent | ConsensusEvent | GraphEvent | CriticalityEvent   │
├──────────────────────────────────────────────────────────────────┤
│                        Storage Layer                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │  Immutable Store  │  │  DAG Context     │  │  Graph Store  │  │
│  │  (append-only)    │  │  (Summary Nodes) │  │  (knowledge)  │  │
│  └──────────────────┘  └──────────────────┘  └───────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component             | Responsibility                                                                                                                                                                                                    | Typical Implementation                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **LCM**               | Deterministic memory: Immutable Store + Active Context DAG + three-level summarization protocol                                                                                                                   | Append-only log (SQLite or file-backed), in-memory DAG of SummaryNode objects, `lcm_grep` / `lcm_expand` primitives |
| **Sheaf Coordinator** | Multi-agent state consensus: vertex/edge stalks, restriction maps, Sheaf Laplacian diffusion, cohomology obstruction detection                                                                                    | Sparse matrix library (mathjs), ADMM solver, graph adjacency with typed stalk spaces                                |
| **TNA / Semantic**    | Semantic graph construction from agent text output: TF-IDF + lemmatization, 4-gram windowing, Force-Atlas layout, Louvain clustering, betweenness centrality, structural gap detection, GraphRAG query generation | Natural-language toolkit (natural / compromise), graph library (graphology), Louvain plugin                         |
| **SOC Metrics**       | Criticality tracking: Von Neumann (structural) entropy, embedding entropy, Critical Discovery Parameter (CDP), surprising-edge ratio, phase-transition detection at iteration ~400                                | Eigenvalue computation (numeric.js / mathjs), embedding similarity (cosine), time-series correlation tracker        |
| **Orchestrator**      | Iteration loop, agent spawn/teardown, `llm_map` parallel dispatch, cross-component wiring, session persistence                                                                                                    | Async event loop (Node.js), typed event bus (EventEmitter or rxjs), lifecycle hooks                                 |

## Recommended Project Structure

```
src/
├── lcm/                        # Lossless Context Management
│   ├── ImmutableStore.ts       # Append-only interaction log
│   ├── ContextDAG.ts           # Hierarchical SummaryNode DAG
│   ├── SummaryNode.ts          # Node type; expand/collapse ops
│   ├── EscalationProtocol.ts   # Three-level summarization (L1/L2/L3)
│   ├── primitives/
│   │   ├── lcm_grep.ts         # Regex search over immutable store
│   │   └── lcm_expand.ts       # Unfold SummaryNode into raw context
│   └── index.ts                # Public LCM interface
│
├── sheaf/                      # Sheaf-Theoretic Coordination
│   ├── CellularSheaf.ts        # Sheaf over communication graph
│   ├── Stalk.ts                # Vertex + edge inner product spaces
│   ├── RestrictionMap.ts       # Consistency maps between stalks
│   ├── SheafLaplacian.ts       # Laplacian construction + diffusion
│   ├── CohomologyAnalyzer.ts   # H0 / H1 computation, obstruction detection
│   ├── ADMMSolver.ts           # Distributed consensus optimizer
│   └── index.ts                # Public Sheaf interface
│
├── tna/                        # Text Network Analysis / Semantic
│   ├── Preprocessor.ts         # TF-IDF, lemmatization, stopword removal
│   ├── NgramWindowBuilder.ts   # 4-gram sliding window, edge weights
│   ├── SemanticGraph.ts        # Weighted graph of concept nodes
│   ├── LouvainDetector.ts      # Community detection / modularity
│   ├── BetweennessCentrality.ts# Conceptual bottleneck scoring
│   ├── GapDetector.ts          # Structural hole identification
│   ├── GraphRAGGenerator.ts    # Catalyst question generation at gaps
│   └── index.ts                # Public TNA interface
│
├── soc/                        # Self-Organized Criticality Metrics
│   ├── VonNeumannEntropy.ts    # Structural graph entropy
│   ├── EmbeddingEntropy.ts     # Semantic discourse entropy
│   ├── CriticalityTracker.ts   # CDP computation, surprising-edge ratio
│   ├── PhaseTransitionDetector.ts # Correlation shift detection (~iter 400)
│   ├── EntropyTimeSeries.ts    # Historical entropy record
│   └── index.ts                # Public SOC interface
│
├── orchestrator/               # Session & iteration management
│   ├── AGEMOrchestrator.ts     # Main loop, agent lifecycle
│   ├── llm_map.ts              # Parallel sub-task dispatch primitive
│   ├── EventBus.ts             # Typed inter-component events
│   ├── AgentPool.ts            # Worker agent spawn/teardown
│   └── index.ts                # Public orchestrator interface
│
├── types/                      # Shared type definitions
│   ├── Agent.ts
│   ├── ContextState.ts
│   ├── GraphTypes.ts
│   └── Events.ts
│
└── index.ts                    # Root entry; assembles all components
```

### Structure Rationale

- **lcm/:** Isolated because memory management is the foundational primitive that all other components depend on. Nothing should modify this module's guarantees; it must be testable in complete isolation before any other component is built.
- **sheaf/:** Isolated pure-math module. Depends only on typed adjacency data; does not import from lcm or tna. The ADMM solver and cohomology analyzer can be unit-tested against synthetic agent graphs.
- **tna/:** Depends on text input from agents (delivered via event bus or direct call) and produces a graph structure consumed by the orchestrator and soc modules. Has no dependency on sheaf internals.
- **soc/:** Depends on outputs from both sheaf (structural entropy from graph) and tna (embedding entropy from semantic graph). It is a pure consumer; it reads, computes, and emits metrics. No other component should import from soc.
- **orchestrator/:** Only component that imports from all others. Acts as the composition root. This keeps cross-component coupling exclusively at the orchestration boundary.
- **types/:** Shared interfaces live here to avoid circular imports between packages.

## Architectural Patterns

### Pattern 1: Layered Dependency with Single Composition Root

**What:** Each of the four core modules (LCM, Sheaf, TNA, SOC) has zero awareness of the others. The Orchestrator is the only component that knows about all four. Cross-component signals flow through a typed event bus, not direct imports.

**When to use:** Mandatory for this project. The success metric is each component independently testable. If Sheaf imports from TNA, you cannot test Sheaf without TNA.

**Trade-offs:** Requires discipline at PR review to reject cross-module imports. Adds a small indirection cost for data sharing (event bus round-trips). Pays off with independent deployability and test isolation.

**Example:**

```typescript
// orchestrator/EventBus.ts
type CriticalityEvent = {
  type: 'criticality:update';
  cdp: number;
  surprisingEdgeRatio: number;
  phaseTransitionDetected: boolean;
};

type ConsensusEvent = {
  type: 'sheaf:consensus';
  iteration: number;
  h1ObstructionDetected: boolean;
};

// SOC module emits; TNA module does NOT import SOC
eventBus.emit({ type: 'criticality:update', cdp: -0.03, ... });

// Orchestrator listens and routes
eventBus.on('criticality:update', (e) => orchestrator.handleCriticality(e));
```

### Pattern 2: Immutable Append-Only Store as Ground Truth

**What:** All agent interactions are written verbatim to the Immutable Store before any computation happens. Active Context (DAG of SummaryNodes) is derived from the store, never the source of record. If the DAG and store disagree, the store wins.

**When to use:** Required for LCM. This is the core guarantee that eliminates hallucination of historical data.

**Trade-offs:** Store grows without bound — must plan for long-running sessions. Reads require `lcm_grep` search primitives rather than simple lookups. The cost is worth it: any agent can reconstruct state deterministically from the store alone.

**Example:**

```typescript
// lcm/ImmutableStore.ts
class ImmutableStore {
  // NEVER update or delete — only append
  append(entry: InteractionRecord): void {
    this.log.push({ ...entry, timestamp: Date.now() });
  }

  grep(pattern: RegExp): InteractionRecord[] {
    return this.log.filter((r) => pattern.test(r.content));
  }
}

// lcm/ContextDAG.ts
class ContextDAG {
  expand(nodeId: string, store: ImmutableStore): RawContext {
    const node = this.nodes.get(nodeId);
    // Always reads from store; DAG holds pointers, not data
    return store.grep(node.storeRef);
  }
}
```

### Pattern 3: Obstruction-Driven Graph Reconfiguration

**What:** The Sheaf Cohomology analyzer (H1 group) acts as a signal source. When non-trivial H1 is detected (agents are in irreconcilable disagreement), the orchestrator does not retry Laplacian diffusion. Instead, it instructs TNA's GapDetector to find the nearest structural gap and dispatches Van der Waals exploratory agents to bridge it, which changes the underlying graph topology and resets the sheaf.

**When to use:** This is the mechanism that prevents the system from deadlocking on unsolvable consensus problems. Mandatory for correct SOC dynamics.

**Trade-offs:** Requires the orchestrator to maintain a state machine with at least three modes: NORMAL (diffusion), OBSTRUCTED (gap-targeted exploration), CRITICAL (post-transition open-ended synthesis).

**Example:**

```typescript
// orchestrator/AGEMOrchestrator.ts
cohomologyAnalyzer.on("h1:non-trivial", async (obstruction) => {
  const gap = await tna.gapDetector.findNearestGap(obstruction.agentSubgraph);
  const catalystQuestion = await tna.graphRAG.generateCatalyst(gap);
  await agentPool.spawnExploratoryAgent({
    mode: "VanDerWaals",
    target: gap,
    seed: catalystQuestion,
  });
  sheaf.resetTopology(agentPool.currentGraph());
});
```

## Data Flow

### Primary Iteration Flow

```
[Agent text output]
    |
    v
[TNA Preprocessor] -- lemmatize, TF-IDF, 4-gram window
    |
    v
[SemanticGraph] -- add nodes/edges, update weights
    |
    +---------> [LouvainDetector] -- community update
    |                |
    |                v
    |           [GapDetector] -- find structural holes
    |                |
    |                v
    |           [GraphRAGGenerator] -- catalyst questions
    |
    v
[EmbeddingEntropy] <-- consumes semantic graph diversity
    |
    v
[SOC: CriticalityTracker]
    ^
    |
[VonNeumannEntropy] <-- consumes Sheaf graph structure
    |
[SheafLaplacian] -- diffuse agent states toward consensus
    |
[CohomologyAnalyzer] -- detect H1 obstructions
    |
[AGEMOrchestrator] -- decide: continue / reconfigure / dispatch
    |
    v
[LCM ImmutableStore] -- record all decisions verbatim
    |
[ContextDAG] -- update summary nodes for active agents
```

### Context Management Flow

```
[Agent receives task]
    |
    v
[lcm_expand(nodeId)] --> ImmutableStore.grep(ref) --> RawContext in window
    |
[Agent processes with full context]
    |
    v
[Agent emits result]
    |
    v
[ImmutableStore.append(result)]   <-- always first
    |
    v
[ContextDAG: update or compress SummaryNode]
    |   If context window soft threshold exceeded:
    |     L1 summarize --> if too long: L2 bullet compress --> if still too long: L3 truncate
    v
[SummaryNode pointer updated; raw data stays in ImmutableStore]
```

### Key Data Flows

1. **Consensus flow (Sheaf):** Agent state vectors (vertex stalks) flow through restriction maps into edge stalks, where the coboundary operator computes disagreement. The Sheaf Laplacian diffuses this disagreement signal back to agents as state update gradients. Runs per-iteration until convergence or H1 obstruction detected.

2. **Semantic enrichment flow (TNA):** Natural language from every agent's chain-of-thought is continuously streamed into the Preprocessor. Concept nodes accumulate in SemanticGraph. Community structure re-runs Louvain every N iterations. GapDetector outputs structural holes to the Orchestrator, which decides whether to spawn Van der Waals exploration agents.

3. **Criticality feedback flow (SOC):** Von Neumann entropy is computed from the Sheaf graph eigenspectrum. Embedding entropy is computed from agent embedding diversity in the semantic graph. CDP = (semantic entropy - structural entropy). PhaseTransitionDetector monitors the cross-correlation sign change. When CDP stabilizes at a slightly negative value and correlation turns negative, the system is in the self-organized critical discovery regime.

4. **Memory retrieval flow (LCM):** Agent needs historical data → calls `lcm_grep(pattern)` → receives matching records from ImmutableStore → loads relevant SummaryNodes into active window via `lcm_expand` → processes → result appended back to ImmutableStore. No LLM inference involved in the retrieval path.

## Scaling Considerations

| Scale                        | Architecture Adjustments                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Single session, 1-10 agents  | In-process, in-memory stores; no infrastructure needed. Full reference implementation as written.                                                                                          |
| Multi-session, 10-100 agents | Replace in-memory ImmutableStore with SQLite or LevelDB. Extract AgentPool to worker threads (Node.js worker_threads). Sheaf Laplacian still fits in-process.                              |
| 100+ agents, long-horizon    | Distributed store (PostgreSQL), message queue for event bus (Redis pub/sub), Sheaf computation on partitioned graph (ADMM already decentralized). TNA graph sharding by Louvain community. |

### Scaling Priorities

1. **First bottleneck:** ImmutableStore memory footprint. Fix by persisting to disk (SQLite) and streaming records rather than holding in RAM. This is the first change needed beyond toy sessions.
2. **Second bottleneck:** SemanticGraph size as node count grows. Fix by pruning low-weight edges (edges below weight threshold), keeping only top-K by betweenness centrality. The graph should be a sparse small-world, not a dense complete graph.

## Anti-Patterns

### Anti-Pattern 1: Shared Mutable State Between Components

**What people do:** Have TNA and Sheaf both import and modify a shared `KnowledgeGraph` object directly, reasoning that it avoids duplication.

**Why it's wrong:** Destroys independent testability. When a Sheaf test fails, you cannot know if TNA modified shared state to cause it. Violates the primary success metric of the project.

**Do this instead:** Each component owns its internal graph representation. The Orchestrator passes data between them through well-typed function calls or event payloads. The Sheaf graph (adjacency of agents) and the TNA semantic graph are structurally different objects that happen to grow in parallel.

### Anti-Pattern 2: Using LLM Inference Inside LCM Primitives

**What people do:** To save code, have `lcm_grep` or `lcm_expand` call the LLM to "smart-summarize" what it retrieves, treating the retrieval as an opportunity to compress further.

**Why it's wrong:** LCM's entire value proposition is determinism. Injecting LLM inference into retrieval makes retrieval stochastic and potentially lossy. The LLM should only ever see the raw content retrieved from the Immutable Store, not a re-summarized version of it.

**Do this instead:** LCM primitives are pure data operations. The LLM receives raw records from `lcm_expand` and summarizes them in the Escalation Protocol flow, which is explicitly controlled and monitored. Never let the retrieval path involve inference.

### Anti-Pattern 3: Running Louvain Community Detection Every Iteration

**What people do:** For correctness, re-run Louvain after every single agent output since the semantic graph has changed.

**Why it's wrong:** Louvain is O(n log n) and deterministic recomputation on every iteration becomes a performance cliff once the graph has thousands of nodes. Community membership rarely changes between adjacent iterations.

**Do this instead:** Run Louvain on a fixed schedule (every N iterations, or when node count has grown by more than X%). Between runs, update edge weights incrementally. Only re-run full community detection when GapDetector reports a potential structural shift.

### Anti-Pattern 4: Skipping the Three-Level Escalation Protocol

**What people do:** Replace the L1/L2/L3 escalation sequence with a single "just ask the model to summarize shorter" prompt, thinking it's simpler.

**Why it's wrong:** If the model fails to compress (L1 output longer than input — documented failure mode), the single-step approach loops infinitely or crashes. The three-level protocol guarantees termination by falling back to algorithmic truncation (L3) which involves no LLM inference.

**Do this instead:** Implement all three levels explicitly. L3 (deterministic truncation) is the safety valve that makes the whole system provably convergent on context management.

## Integration Points

### External Services

| Service                                | Integration Pattern                                                        | Notes                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| LLM provider (OpenAI, Anthropic, etc.) | HTTP client wrapped in AgentPool; all calls go through `llm_map` primitive | Never call LLM directly from LCM, Sheaf, TNA, or SOC. All inference is orchestrated.                        |
| Embedding model                        | HTTP client in TNA/EmbeddingEntropy; called to vectorize agent text output | Used by EmbeddingEntropy (SOC) and GapDetector (TNA). Same provider as LLM or dedicated embedding endpoint. |
| Persistent store (optional SQLite)     | Adapter pattern behind ImmutableStore interface                            | Swap from in-memory to file-backed without changing LCM API surface.                                        |

### Internal Boundaries

| Boundary              | Communication                                                                                                | Notes                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Orchestrator -> LCM   | Direct method calls (`store.append()`, `dag.expand()`)                                                       | LCM is synchronous; no events needed. Orchestrator is the only caller.                |
| Orchestrator -> Sheaf | Direct method calls (`sheaf.addAgent()`, `laplacian.iterate()`, `cohomology.analyze()`)                      | Sheaf runs per-iteration; orchestrator drives it.                                     |
| Orchestrator -> TNA   | Direct method calls for ingestion (`preprocessor.ingest(text)`); event for gap signals                       | TNA gap events are async; orchestrator handles `gap:detected` events to spawn agents. |
| Sheaf -> SOC          | Orchestrator reads Sheaf graph and passes eigenspectrum to VonNeumannEntropy; Sheaf does not know SOC exists | Decoupled via orchestrator relay.                                                     |
| TNA -> SOC            | Orchestrator reads SemanticGraph diversity and passes to EmbeddingEntropy; TNA does not know SOC exists      | Decoupled via orchestrator relay.                                                     |
| SOC -> Orchestrator   | Event: `criticality:phase-transition`                                                                        | SOC is the only outbound signaler; orchestrator decides what to do.                   |
| All components -> LCM | Only Orchestrator writes to LCM on behalf of all components; components themselves do not write              | Enforces single writer for the Immutable Store.                                       |

## Build Order

Dependencies between components determine the safe build sequence:

1. **types/** — Define shared interfaces first. Nothing can compile without `ContextState`, `GraphTypes`, `Events`. No dependencies.

2. **lcm/** — Immutable Store and ContextDAG have no external dependencies. Build and fully test before anything else. If memory guarantees fail, the entire system's reliability fails.

3. **sheaf/** — Depends only on typed adjacency data (from types/). No dependency on lcm, tna, or soc. Can be built and unit-tested in parallel with lcm once types/ exists.

4. **tna/** — Depends only on types/ for graph types and text input contracts. No dependency on lcm or sheaf. Can proceed in parallel with sheaf after types/ is complete.

5. **soc/** — Depends on outputs from sheaf (eigenspectrum) and tna (embedding entropy). Cannot be implemented before sheaf and tna interfaces are stable. No circular dependency risk.

6. **orchestrator/** — Final integration layer. Imports from all four core modules. Should only begin once all four modules have passing unit tests independently. Integration tests live here.

```
types/
  |
  +----> lcm/          [independent, build first after types]
  |
  +----> sheaf/        [independent, parallel with lcm]
  |
  +----> tna/          [independent, parallel with lcm/sheaf]
              \
               +-> soc/         [depends on sheaf + tna outputs]
                        \
                         +-> orchestrator/   [depends on all four]
```

## Sources

- RLM-LCM Molecular-CoT framework source document: `docs/RLM-LCM-Molecular-CoT-Group-Evolving-Agents.md` (primary reference throughout)
- LCM paper: arXiv:submit/7269166 [cs.AI] — Voltropy (https://papers.voltropy.com/LCM)
- Molecular-CoT topology: "Mapping the Topology of Long Chain-of-Thought Reasoning" — arXiv 2601.06002v2
- Sheaf multi-agent coordination: "Applied Sheaf Theory For Multi-agent AI" — arXiv 2504.17700v1; "Distributed Multi-agent Coordination over Cellular Sheaves" — arXiv 2504.02049
- Sheaf Cohomology: "Sheaf Cohomology of Linear Predictive Coding Networks" — OpenReview
- InfraNodus TNA methodology: https://infranodus.com/docs/text-network-analysis
- Self-Organized Criticality: "Self-Organizing Graph Reasoning Evolves into a Critical State" — arXiv 2503.18852v1; AIP Chaos journal (DOI: 10.1063/5.0272412)
- Agentic deep graph reasoning: arXiv 2502.13025v1

---

_Architecture research for: RLM-LCM Molecular-CoT Group Evolving Agents — TypeScript/JavaScript reference implementation_
_Researched: 2026-02-27_
