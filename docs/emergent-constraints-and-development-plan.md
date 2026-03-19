# Emergent Constraints: Theoretical Foundation & Development Plan

## From Fixed Rules to Artificial Biology

AGEM's architecture is not a set of engineering decisions — it is a set of **artificial biological constraints** that force emergent structure. This document traces the theoretical foundation from emergent constraint theory through AGEM's existing modules and identifies the next development phase.

The core thesis: instead of programming rules into reasoning agents, create computational pressures (memory bottlenecks, coordination requirements, topology constraints) and let the rules emerge. This is the shift from "delineating fixed constraints" to "explicating the emergence of constraints."

---

## Four Emergent Mechanisms

### 1. Memory Bottleneck → Hierarchical Syntax (LCM)

**Theory**: Memory capacity limits and the serial nature of output create mandatory bottlenecks that force hierarchical syntax to emerge. Context windows and context rot are not defects — they are the exact computational pressure required to force a system to invent its own syntax.

**AGEM Implementation**: The LCM `EscalationProtocol` implements three escalation levels:
- **L1**: Light summarization (token budget exceeded by minor margin)
- **L2**: Aggressive compression (major margin exceeded)
- **L3**: Hard truncation (K-token hard cap reached)

Each level forces the system to create `SummaryNode` entries in a DAG — this IS hierarchical syntax emerging from memory pressure. The pressure to compress sequences into latent representations causes those pathways to "fossilize" into efficient, domain-specific-looking rules.

**Reframing**: The `LumpabilityAuditor` is not just a deception detector. It is a **quality metric for emergent syntax**:
- **Strong lumpability** = the compression bottleneck produced good structural rules
- **Weak lumpability** = the bottleneck destroyed information that needed to remain articulated
- The `entropy_preservation_ratio` measures how well the artificial biology is working

**Key insight**: Compressing data into a hierarchical summary DAG isn't a workaround for token limits — it is the artificial equivalent of human biological constraints. The limitation *is* the engine of structural complexity.

### 2. C-Induction → Multi-Agent Synchronization (Sheaf Cohomology)

**Theory**: The distinction between N-Induction (lone scientist seeking objective truth) and C-Induction (social coordination around Schelling focal points) unlocks group-evolving agents. Instead of every agent brute-forcing independent truth discovery, agents rewarded for aligning their reasoning with peers naturally converge on "focal points" — shared conventions that make experience transfer efficient.

**AGEM Implementation**: Sheaf cohomology is the mathematical formalization of C-Induction:
- **H¹ = 0**: Agents have found Schelling focal points — shared conventions established. C-Induction succeeded.
- **H¹ > 0**: C-Induction has failed. Agents haven't converged on focal points. The `ObstructionHandler` triggers `VdWAgentSpawner` to introduce a new perspective and break the deadlock.
- **ADMM Solver**: The gradient descent toward consensus IS the C-Induction process running iteratively.

**Reframing**: The `System 1 Override Detector` (EE stabilizes before VNE develops) maps to **premature C-Induction** — agents converging on a focal point before they've explored the problem space. Coordination pressure causes premature consensus that looks like understanding but is social mimicry.

### 3. Price Equation → Chain-of-Thought Evolution (**NOT YET IMPLEMENTED**)

**Theory**: If language is a cultural system "winnowed" through generations, the same dynamic maps onto internal reasoning via the Price equation and Pólya urn dynamics. Reasoning steps that successfully resolve ambiguities gain "prestige" and are returned to the urn with multiples. The Price equation maps the directional change of this population of thoughts. Domain-specific frameworks that dominate output aren't prompt instructions — they're the mathematical inevitability of stochastic selection.

**Gap in AGEM**: SOCTracker *observes* criticality (VNE, EE, CDP, SER, correlation) but doesn't *drive* evolution. The TNA graph accumulates edge weights by co-occurrence but has no Pólya urn dynamic where successful reasoning paths get preferential reinforcement.

**Development Plan — `PriceEvolver` Module** (`src/evolution/`):

1. **Path Tagging**: After each cycle, tag TNA edges with outcome fitness:
   - Did this edge help close a structural gap? → +fitness
   - Did this edge reduce H¹ obstruction dimension? → +fitness
   - Did this edge increase CDP (conceptual diversity)? → +fitness
   - Was this edge flagged by LumpabilityAuditor as weak? → −fitness

2. **Pólya Reinforcement**: Apply multiplicative weight updates:
   ```
   w_new = w_old × (1 + α × fitness)
   ```
   where α is a learning rate tied to the SOC regime:
   - `nascent` → high α (explore aggressively)
   - `stable` → low α (exploit known-good paths)
   - `critical` → medium α (balanced recovery)

3. **Price Equation Tracking**: Decompose each iteration's change:
   ```
   Δz̄ = Cov(w,z)/w̄ + E(wΔz)/w̄
   ```
   - First term: **Selection** — which reasoning paths are winning?
   - Second term: **Transmission bias** — are winning paths mutating?
   - This maps directly to CDP's explore/exploit readout

4. **Dashboard Integration**: New sparkline showing selection vs transmission pressure alongside existing SOC metrics.

5. **EventBus Integration**: Subscribe to `tna:gap-closed`, `sheaf:h1-change`, `lumpability:audit-complete`, `phase:transition` events.

### 4. Syntactic Carpentry → Graph Topology (TNA)

**Theory**: Deconstructing binding constraints into "processing carpentry" reframes syntactic rules as paths of least resistance across a topological structure. When a graph reasoning system self-organizes, it inevitably develops its own binding principles to avoid infinite loops and resolve node dependencies efficiently.

**AGEM Implementation**: Already functional:
- **Louvain community detection** finds "syntactic regions" — clusters of tightly-bound concepts
- **Gap detection** identifies unresolved dependencies (structural holes between communities)
- **Catalyst questions** are the mechanism for binding — resolving dangling references at the first opportunity (Principle A)
- **Centrality analysis** identifies load-bearing nodes — the structural "carpentry" holding the graph together
- **ForceAtlas2 layout** makes the topology visible, revealing emergent structure in the semantic network

---

## Architecture Map: Theory → Implementation

| Theoretical Concept | AGEM Module | Status |
|---|---|---|
| Memory bottleneck → syntax | LCM EscalationProtocol | ✅ Built |
| Compression quality metric | LumpabilityAuditor | ✅ Built |
| C-Induction focal points | Sheaf H¹ = 0 (consensus) | ✅ Built |
| Failed C-Induction recovery | ObstructionHandler → VdW Spawn | ✅ Built |
| Premature convergence | System 1 Override Detector | ✅ Built |
| Syntactic binding as topology | TNA Gap Detection + Catalyst Q's | ✅ Built |
| Criticality observation | SOCTracker (VNE/EE/CDP/SER) | ✅ Built |
| Price equation feedback | PriceEvolver | 🔲 Planned |
| Pólya urn reinforcement | Path fitness → weight update | 🔲 Planned |
| Selection vs transmission | Price decomposition metric | 🔲 Planned |

---

## Recent Engineering Improvements

### Dashboard UI (interface/frontend)
The right panel is now a full system dashboard replacing the empty graph placeholder:
- **SystemVitals strip**: Always-visible status bar showing iteration, regime (nascent/stable/critical/transitioning), operational state, CDP, H¹ warnings, graph stats
- **Tabbed content**: Graph (ForceGraph2D), Metrics (SOC sparklines + lumpability + regime stats), Events (scrollable log)
- **Quick Actions**: 8 buttons for common AGEM operations with explanatory hover tooltips
- **Toast notifications**: Auto-dismissing overlays for critical events (System 1, weak lumpability, phase transitions, H¹ obstructions)
- **Independent SSE**: `/api/v1/system/events` streams system events to the dashboard independently of chat completions

### Meta-Tool Pattern (MCP Access)
Instead of dumping 50+ MCP tool schemas onto local models (which overwhelms them), the system provides 3 meta-tools:
- `list_mcp_servers` → discover available servers and tool counts
- `list_server_tools(server)` → see tools and descriptions on a specific server
- `call_mcp_tool(server, tool, args)` → invoke any tool on any server

This gives every model (local or cloud) full access to all MCP capabilities through a 13-tool interface instead of 50+. Pattern adapted from the mcp_coordinator project.

### Provider Embeddings
- `ProviderEmbedder` replaces `MockEmbedder` for real semantic similarity
- Ollama: calls `/api/embeddings` with `nomic-embed-text` (768-dim)
- OpenRouter: calls `/embeddings` with `google/gemini-embedding-001`
- Graceful fallback: if embedding API fails 3 times, falls back to hash-based mock at the provider's native dimension
- `/api/v1/system/embeddings` POST endpoint for external consumers

### Ollama Tool Calling
- Model capabilities detected via `/api/show` → `capabilities` array (not family heuristics)
- Frontend model dropdown shows 🔧 for tool-capable models, filters embedding models, shows context length
- Content fallback parser extracts tool calls from models that output JSON text instead of structured `tool_calls`
- Provider-correct message formats: Ollama gets `{role: "tool", tool_name}`, OpenRouter gets `{role: "tool", tool_call_id}`

---

## Development Roadmap

### Phase 1: PriceEvolver Module (Next)
- [ ] `src/evolution/interfaces.ts` — PathFitness, PriceDecomposition types
- [ ] `src/evolution/PriceEvolver.ts` — EventBus subscriber, fitness tagging, Pólya reinforcement, Price decomposition
- [ ] `src/evolution/PriceEvolver.test.ts` — unit tests
- [ ] Wire into ComposeRootModule
- [ ] Dashboard: selection/transmission pressure sparkline

### Phase 2: Real Embedding Integration
- [ ] Replace `MockEmbedder` usage in core engine tests with `ProviderEmbedder` integration tests
- [ ] Wire Orchestrator's internal LCMClient store into the bridge's LCMGrep (shared store)
- [ ] Embedding-based SER (Surprising Edge Ratio) using real cosine similarity

### Phase 3: Persistent Vector Memory
- [ ] Evaluate ChromaDB vs Milvus Lite for session-persistent embeddings
- [ ] Persist EmbeddingCache across resets for long-running analysis
- [ ] Cross-session knowledge transfer via embedding similarity search

### Phase 4: Autonomous Agent Loop
- [ ] Self-directed cycle execution (agent decides when to run cycles)
- [ ] Catalyst question auto-injection (system feeds its own bridging questions)
- [ ] Price-guided exploration (PriceEvolver directs which topics to explore next)
- [ ] Emergent termination criteria (system recognizes when understanding is "complete")

---

*This document synthesizes insights from emergent constraint theory, evolutionary epistemology, and the AGEM codebase. The theoretical framework draws on analysis of memory bottleneck-driven syntax emergence, C-Induction social coordination, the Price equation for cultural evolution, and topological approaches to syntactic structure.*
