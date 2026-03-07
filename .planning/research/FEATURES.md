# Feature Research

**Domain:** Multi-agent AI system — RLM-LCM Molecular-CoT Group Evolving Agents (TypeScript/JavaScript reference implementation)
**Researched:** 2026-02-27
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any reference implementation of an advanced multi-agent framework must include to be taken seriously. Missing these makes the implementation feel incomplete or academically untrustworthy.

| Feature                                            | Why Expected                                                                                                                                                                                                                                                                               | Complexity | Notes                                                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Immutable append-only interaction log**          | Every credible agent framework stores a ground-truth record of all interactions; LangGraph, AutoGen, CrewAI all have persistent state. LCM's ImmutableStore is the framework-specific form of this universal requirement.                                                                  | LOW        | SQLite or in-memory array with no delete/update operations. The interface matters more than the backend.                                                   |
| **Active context window management**               | Context window overflow is the primary failure mode for long-horizon agents. All major frameworks (LangGraph MemorySaver, CrewAI memory layers, AutoGen context_variables) address this. LCM's DAG of SummaryNodes is the differentiating form but the expectation itself is table stakes. | MEDIUM     | DAG structure is what makes this LCM-specific; the generic need is universal.                                                                              |
| **Three-level summarization escalation**           | Context compaction that fails silently is a known failure mode in production agents. A convergence guarantee (L3 deterministic truncation as safety valve) is required for any implementation claiming lossless behavior.                                                                  | MEDIUM     | L1 (nuanced summary) → L2 (bullet compression) → L3 (algorithmic truncation). L3 must involve zero LLM inference.                                          |
| **lcm_grep primitive**                             | Regex or pattern search over stored interactions is the minimum viable retrieval mechanism. Direct analogue of database query against the persistent store.                                                                                                                                | LOW        | Must be deterministic; must return raw records without LLM involvement.                                                                                    |
| **lcm_expand primitive**                           | Ability to load a SummaryNode's raw content into the active window for processing is required for any DAG-based context architecture.                                                                                                                                                      | LOW        | Expand returns raw store records; collapse compresses back.                                                                                                |
| **Multi-agent orchestration loop**                 | All comparable frameworks (LangGraph state machine, CrewAI process, AutoGen conversation flow) require an iteration loop managing agent lifecycle. The AGEMOrchestrator is the project-specific form.                                                                                      | MEDIUM     | Must manage agent spawn/teardown, pass data between components, and detect termination conditions.                                                         |
| **llm_map parallel dispatch primitive**            | Horizontal scaling via parallel sub-task distribution is explicitly described as the primary mechanism for bypassing context saturation. Any implementation without this cannot demonstrate the scaling property that distinguishes LCM from symbolic recursion.                           | HIGH       | Dispatches N sub-tasks to N worker agents concurrently; collects and aggregates deterministic results. Requires async coordination.                        |
| **Typed shared interfaces / event bus**            | Inter-component communication without shared mutable state requires a typed event bus or equivalent. This is architecturally mandated by the independent-testability constraint and is standard practice in mature TypeScript agent frameworks (Mastra, VoltAgent, ADK for TypeScript).    | LOW        | TypeScript types for ContextEvent, ConsensusEvent, GraphEvent, CriticalityEvent. EventEmitter or rxjs.                                                     |
| **Unit-testable component boundaries**             | A reference implementation must be verifiable against its mathematical claims. LangGraph, AutoGen, and all production frameworks provide component-level tests. Without testable boundaries the implementation cannot be used as a reference.                                              | MEDIUM     | Each of the four core modules (LCM, Sheaf, TNA, SOC) must pass unit tests in isolation before integration.                                                 |
| **Sheaf Laplacian construction and diffusion**     | The Sheaf Laplacian is the core coordination mechanism. Without it the multi-agent coordination claim is unsupported. This is the minimum viable form of sheaf-theoretic coordination.                                                                                                     | HIGH       | Requires sparse matrix representation of agent graph, coboundary operator computation, and iterative diffusion. mathjs or a similar sparse matrix library. |
| **Vertex and edge stalk spaces**                   | Stalks are the mathematical objects that make cellular sheaves different from plain graphs. Without typed stalk spaces, the implementation collapses to a conventional graph-based system without sheaf-theoretic guarantees.                                                              | MEDIUM     | Inner product spaces assigned to each vertex (agent state) and edge (interaction channel).                                                                 |
| **Restriction maps between stalks**                | Restriction maps are the mechanism by which local agent states project into shared interaction spaces. Without them, the Laplacian has no input and consensus detection is impossible.                                                                                                     | MEDIUM     | Linear maps from vertex stalk to edge stalk. Can be identity maps initially; correctness matters more than generality in v1.                               |
| **TF-IDF preprocessing and lemmatization**         | Any text network analysis pipeline requires text normalization before graph construction. This is the minimum preprocessing step described in InfraNodus methodology.                                                                                                                      | LOW        | Remove stopwords, apply TF-IDF weighting, lemmatize active terms. Natural or compromise library in Node.js.                                                |
| **4-gram sliding window edge builder**             | The 4-gram window is the specific InfraNodus mechanism for constructing weighted semantic edges from co-occurrence. It is named explicitly in the framework document and distinguishes contextual TNA from bag-of-words approaches.                                                        | LOW        | Adjacent terms receive weight 3, separated by one term receive weight 2, etc. Standard sliding window.                                                     |
| **Weighted semantic graph**                        | The semantic graph is the data structure that TNA operates on. Without it, Louvain detection, betweenness centrality, and gap detection have no input.                                                                                                                                     | LOW        | Weighted undirected graph of concept nodes. graphology is the recommended TypeScript library.                                                              |
| **Louvain community detection**                    | Community detection identifies topical clusters, which are the prerequisite for structural gap identification. Without community structure there are no cluster boundaries and no gaps to detect.                                                                                          | MEDIUM     | Standard Louvain modularity optimization. graphology-communities-louvain plugin exists. Runs on schedule, not per-iteration.                               |
| **Betweenness centrality computation**             | Node ranking by centrality identifies conceptual bottlenecks and bridge nodes. Required by the InfraNodus methodology and cited explicitly in the framework document.                                                                                                                      | MEDIUM     | Brandes algorithm or equivalent. O(VE) complexity; must be scheduled, not per-iteration.                                                                   |
| **Structural gap detection**                       | Gap detection is the mechanism by which the system identifies what it does not know. Without it, Van der Waals exploratory agents have no targeting vector and the SOC feedback loop is broken.                                                                                            | HIGH       | Scan for low-edge-density zones between distinct Louvain communities. Output: spatial coordinates and community pair of each structural hole.              |
| **Von Neumann entropy computation**                | Structural entropy is one of the two metrics required for the Critical Discovery Parameter (CDP). Without it the SOC monitoring layer cannot function.                                                                                                                                     | HIGH       | Computed from eigenspectrum of Sheaf graph's normalized Laplacian. Expensive; must be computed incrementally or approximated for large graphs.             |
| **Embedding entropy computation**                  | Semantic entropy is the second CDP metric. Measures informational richness and conceptual diversity of agent discourse.                                                                                                                                                                    | HIGH       | Computed from vector embedding distribution of agent text outputs. Requires embedding model API. Shannon entropy over embedding similarities.              |
| **Critical Discovery Parameter (CDP) computation** | CDP = (semantic entropy - structural entropy). The framework states this must stabilize at a slightly negative value for sustained discovery mode. Without CDP tracking, the SOC monitoring claim is unsupported.                                                                          | MEDIUM     | Simple arithmetic over the two entropy measures. The computation is trivial; the interpretation and monitoring logic is the complexity.                    |
| **Surprising edge ratio tracking**                 | The ~12% surprising edge ratio is a named empirical property of the system in its critical state. Monitoring it is required to validate that the system is operating correctly.                                                                                                            | MEDIUM     | Classify each new edge as "surprising" (connects semantically distant clusters, high community distance) or "expected". Track rolling ratio.               |
| **LLM provider integration**                       | No multi-agent framework is useful without connecting to an actual language model. All comparable frameworks (LangGraph, Mastra, VoltAgent, ADK) provide LLM client abstractions.                                                                                                          | LOW        | HTTP client wrapper around OpenAI/Anthropic API. Called exclusively through the llm_map primitive; never directly from LCM, Sheaf, TNA, or SOC modules.    |

---

### Differentiators (Competitive Advantage)

Features that distinguish this implementation from conventional multi-agent frameworks and provide the unique value of the RLM-LCM Molecular-CoT approach.

| Feature                                                               | Value Proposition                                                                                                                                                                                                                                                                                                                                                                  | Complexity | Notes                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sheaf Cohomology obstruction detection (H0/H1)**                    | No existing production framework (LangGraph, AutoGen, CrewAI, Mastra) implements algebraic-topological obstruction detection. H1 cohomology quantifies precisely when global agent consensus is mathematically impossible given current topology, not just difficult or slow. This is the differentiating mathematical claim of the framework.                                     | HIGH       | Requires computing ker(coboundary operator) for H0 and the first cohomology group for H1. Non-trivial H1 signals a topological deadlock that Laplacian diffusion cannot resolve. Triggers graph reconfiguration via orchestrator.  |
| **ADMM-based distributed consensus solver**                           | ADMM (Alternating Direction Method of Multipliers) is the state-of-the-art distributed optimization technique for sheaf homological programs. Combining it with the Sheaf Laplacian produces guaranteed convergence toward consensus without a centralized controller. No mainstream agent framework includes distributed consensus with convergence guarantees.                   | HIGH       | Distributed by design; each agent updates based on local observations and local communication only. Convergence at linear rate guaranteed by Laplacian flow properties.                                                            |
| **Obstruction-driven graph reconfiguration**                          | When H1 obstruction is detected, the system does not retry consensus — it dispatches Van der Waals exploratory agents to restructure the underlying graph topology. This is a self-healing architectural pattern with no equivalent in existing frameworks.                                                                                                                        | HIGH       | Requires orchestrator state machine with NORMAL / OBSTRUCTED / CRITICAL modes. On H1 detection: find nearest TNA structural gap, spawn exploratory agent, reset sheaf over new topology.                                           |
| **Molecular Chain-of-Thought bond topology**                          | Covalent (deep reasoning), Hydrogen (self-reflection), and Van der Waals (exploration) bond types encode qualitatively different logical relationships in the reasoning chain. No other framework models chain-of-thought as a molecular structure with bond-type semantics governing reasoning integrity and error propagation.                                                   | HIGH       | Requires classifying each reasoning step's relationship to prior steps as covalent, hydrogen, or Van der Waals. Bond rupture detection governs when the orchestrator triggers self-correction.                                     |
| **GraphRAG catalyst question generation at structural gaps**          | When a semantic gap is identified, the system generates targeted questions designed specifically to bridge isolated knowledge clusters. The gap's topological coordinates (community pair, spatial distance) are used as GraphRAG context. This is autonomous self-directed discovery, not passive retrieval.                                                                      | HIGH       | Requires gap-to-question generation pipeline: gap coordinates → community summary context → LLM generates bridging hypothesis question → question dispatched as agent task.                                                        |
| **Phase transition detector (structural-semantic decoupling)**        | The framework identifies a critical milestone at approximately iteration 400 where the cross-correlation between structural and semantic entropy shifts from positive to negative. Detecting and signaling this transition marks the system's entry into open-ended discovery mode. No comparable framework monitors or theorizes about phase transitions in agent swarm dynamics. | HIGH       | Cross-correlation time series analysis between Von Neumann entropy and embedding entropy series. Sign-change detection triggers phase-transition event. Iteration count is approximate; the correlation sign is the actual signal. |
| **CDP stabilization monitoring and regime validation**                | Continuous monitoring of whether CDP has stabilized at its target value (slightly negative) allows the system to validate it is in the correct operating regime. This is self-validation of a mathematical property, not just metric logging.                                                                                                                                      | MEDIUM     | CDP time series with rolling average. Alert if CDP drifts toward zero (too structural) or too negative (semantic chaos).                                                                                                           |
| **Force-Atlas spatial layout for semantic graph**                     | Force-Atlas positions nodes based on repulsion between high-degree hubs and attraction of low-degree periphery nodes. This produces the small-world, scale-free topology the framework targets and distinguishes TNA's graph construction from random or hierarchical layouts used in simpler frameworks.                                                                          | MEDIUM     | Force-directed layout algorithm. Can be computed offline after community detection. Required for correct gap detection spatial coordinates.                                                                                        |
| **Dual-memory bifurcation (Immutable Store + Active Context DAG)**    | The strict separation between write-once ground truth and read-optimized active context is more rigorous than the memory models in LangGraph (checkpoint-based), CrewAI (multi-database layers), or AutoGen (context variable objects). The DAG of SummaryNodes with pointer-based expansion is architecturally novel.                                                             | MEDIUM     | ImmutableStore never modified after write. ContextDAG holds pointers to ImmutableStore records; `lcm_expand` loads raw records. DAG nodes are compressed functional labels, not data copies.                                       |
| **Preferential attachment and scale-free network emergence**          | The knowledge graph is designed to exhibit preferential attachment dynamics, producing dominant hub nodes and bridge nodes that mirror complex biological and physical systems. The implementation monitors this emergence as a property, not just a side effect.                                                                                                                  | MEDIUM     | Track degree distribution over iterations. Verify power-law emergence as network matures. Alert if distribution becomes too uniform (random) or too centralized (star topology).                                                   |
| **Hierarchical compositional reasoning (node-level + synergy-level)** | Agents operate simultaneously at the granular fact level and at the cross-domain bridge level. Category-theoretic framing of nodes as composable abstractions enables synthesis beyond rote retrieval.                                                                                                                                                                             | HIGH       | Requires agent role differentiation: deep-dive agents (covalent bond logic) vs. bridge agents (Van der Waals logic). Orchestrator assigns roles based on gap signals and H1 obstruction events.                                    |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem like natural additions but would damage the reference implementation's primary purpose or introduce complexity without value in v1.

| Feature                                          | Why Requested                                                                                                                                                                                         | Why Problematic                                                                                                                                                                                                                                                                                                                                                      | Alternative                                                                                                                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web UI / visualization dashboard**             | Visualization of the semantic graph, SOC metrics, and agent coordination is appealing for demonstration.                                                                                              | A UI is a separate application, not a library. Building it in v1 couples the reference implementation to a specific rendering technology, blows up scope, and obscures the algorithmic correctness goal. The architecture is a library; consumers build the UI.                                                                                                      | Expose a JSON API or event stream of graph state, entropy metrics, and gap coordinates. Consumers (InfraNodus, Grafana, custom dashboards) can visualize independently.                                          |
| **Real-time interactive agent conversations**    | Users want to query the agent swarm and get answers interactively.                                                                                                                                    | Interactive responsiveness requires latency engineering (streaming, partial results, timeout handling) that is orthogonal to demonstrating mathematical correctness. Optimizing for responsiveness will tempt shortcuts in the Immutable Store write path and LCM guarantees.                                                                                        | Build the reference implementation with correct synchronous semantics. Interactive use cases are a separate layer on top.                                                                                        |
| **Production deployment infrastructure**         | Kubernetes configs, Docker compose, health checks, and horizontal pod autoscaling feel necessary for a "real" implementation.                                                                         | Infrastructure is not part of the algorithmic reference. Adding it increases maintenance burden, couples the project to specific cloud providers, and distracts from the mathematical properties being demonstrated. The out-of-scope section of PROJECT.md explicitly excludes this.                                                                                | Document scaling patterns (in-process → SQLite → PostgreSQL → distributed) as architecture guidance, not runnable configuration.                                                                                 |
| **Plugin marketplace / agent registry**          | Dynamic agent discovery and capability registration (like VoltAgent's extension system or AWS Agent Squad's registry) makes the system feel more production-ready.                                    | Dynamic agent discovery requires a service registry, heartbeat protocol, and capability schema negotiation — a substantial infrastructure project independent of the mathematical claims. Conflating this with the reference implementation obscures what the framework actually demonstrates.                                                                       | Define a static AgentPool interface that can be extended to a registry in v2. Document the extension point without building the infrastructure.                                                                  |
| **Multi-language bindings (Python, Java, etc.)** | Python has the richest ML ecosystem; researchers may want Python for Sheaf or TNA modules.                                                                                                            | Multi-language bindings require build tooling for each language, maintained API parity, and separate test suites. PROJECT.md explicitly constrains v1 to TypeScript/JavaScript for accessibility and modern tooling reasons.                                                                                                                                         | Complete the TypeScript reference implementation first. Publish the mathematical interfaces and data contracts so that Python or other ports can be built against the same specification.                        |
| **LLM-smart retrieval in LCM primitives**        | It is tempting to have `lcm_grep` or `lcm_expand` call the LLM to generate a smarter summary of what is retrieved, making retrieval context-sensitive.                                                | LCM's value is determinism. Injecting LLM inference into retrieval makes every retrieval stochastic and potentially lossy, destroying the mathematical guarantees that distinguish LCM from standard RAG systems.                                                                                                                                                    | LCM primitives are pure data operations. Summarization happens only in the Escalation Protocol flow, which is explicitly monitored. Retrieved records are always raw.                                            |
| **Running Louvain detection every iteration**    | For correctness, re-run community detection after every agent output since the semantic graph has changed.                                                                                            | Louvain is O(n log n) and deterministic recomputation on every iteration creates a performance cliff at scale. Community membership rarely changes between adjacent iterations.                                                                                                                                                                                      | Run Louvain on a fixed schedule (every N iterations) or when node count has grown by more than a threshold. Between runs, update edge weights incrementally.                                                     |
| **Centralized consensus controller**             | A master agent that collects all agent states and computes consensus centrally is simpler to implement than the Sheaf Laplacian.                                                                      | A centralized controller is exactly what the Sheaf Laplacian architecture is designed to eliminate. It reintroduces a single point of failure, destroys the decentralized coordination property, and makes the implementation indistinguishable from a hub-and-spoke multi-agent system. The mathematical claim of the framework requires decentralized convergence. | Implement the Sheaf Laplacian with ADMM as specified. The distributed update rule is the point.                                                                                                                  |
| **Shared mutable state between components**      | Having TNA and Sheaf both import and modify a shared `KnowledgeGraph` object avoids code duplication.                                                                                                 | Destroys independent testability. When a Sheaf test fails, you cannot know if TNA modified shared state to cause it. The primary success metric of a reference implementation is that each mathematical property can be verified in isolation.                                                                                                                       | Each component owns its internal graph representation. The Orchestrator passes data between them through well-typed function calls or event payloads.                                                            |
| **Aggressive performance optimization in v1**    | Eager developers will want to optimize Von Neumann entropy computation (currently O(n^3) for eigendecomposition) or parallelize Louvain before the reference implementation is functionally complete. | Premature optimization obscures algorithmic correctness. If the optimized version produces different numerical results, it becomes impossible to validate against the mathematical properties. PROJECT.md explicitly defers performance optimization.                                                                                                                | Implement correct, readable algorithms first. Document the known computational bottlenecks (Von Neumann entropy eigendecomposition, Louvain at scale) with references to optimization literature as future work. |

---

## Feature Dependencies

```
[LLM Provider Integration]
    └──required by──> [llm_map parallel dispatch]
                          └──required by──> [Multi-agent orchestration loop]

[Typed shared interfaces]
    └──required by──> [Event bus]
                          └──required by──> [All inter-component communication]

[Immutable append-only log]
    └──required by──> [lcm_grep primitive]
    └──required by──> [lcm_expand primitive]
    └──required by──> [Three-level escalation protocol]
                          └──all required by──> [Active context window management]

[Vertex and edge stalk spaces]
    └──required by──> [Restriction maps]
                          └──required by──> [Sheaf Laplacian]
                                                └──required by──> [Sheaf Cohomology H0/H1]
                                                └──required by──> [Von Neumann entropy]
                                                └──required by──> [ADMM distributed solver]

[Sheaf Cohomology H0/H1]
    └──triggers──> [Obstruction-driven graph reconfiguration]
                       └──requires──> [Structural gap detection]
                       └──requires──> [GraphRAG catalyst question generation]

[TF-IDF preprocessing + lemmatization]
    └──required by──> [4-gram sliding window edge builder]
                          └──required by──> [Weighted semantic graph]
                                                └──required by──> [Louvain community detection]
                                                └──required by──> [Betweenness centrality]
                                                └──required by──> [Structural gap detection]
                                                └──required by──> [Force-Atlas layout]
                                                └──required by──> [Embedding entropy]

[Von Neumann entropy] ──feeds──> [CDP computation]
[Embedding entropy] ──feeds──> [CDP computation]
    └──both required by──> [Critical Discovery Parameter]
                               └──required by──> [Surprising edge ratio tracking]
                               └──required by──> [Phase transition detector]
                               └──required by──> [CDP stabilization monitoring]

[Structural gap detection] ──targeting vector for──> [Van der Waals exploratory agents]
[Sheaf Cohomology H1] ──signal for──> [Van der Waals exploratory agents]

[Phase transition detector] ──enhances──> [CDP stabilization monitoring]
    └──both ──signal to──> [Multi-agent orchestration loop]
```

### Dependency Notes

- **Typed shared interfaces required by everything:** Types must be defined first. Nothing else compiles without `ContextState`, `GraphTypes`, and `Events`. Zero dependencies; build first.
- **LCM primitives require Immutable Store:** `lcm_grep` and `lcm_expand` are pure lookups against the store. The store is not just a dependency — it is the guarantee that makes them deterministic.
- **Sheaf Laplacian requires stalk spaces and restriction maps:** The Laplacian is constructed from the coboundary operator, which requires restriction maps, which require stalk spaces. This chain is sequential.
- **Sheaf Cohomology requires Sheaf Laplacian:** H0 is the kernel of the coboundary operator; H1 is the quotient of the kernel by the image. Both are derived from the Laplacian machinery.
- **Von Neumann entropy requires Sheaf graph (not TNA graph):** The structural entropy is computed from the Sheaf graph's normalized Laplacian eigenspectrum. The TNA semantic graph is a different object.
- **CDP requires both entropy measures:** CDP = semantic entropy - structural entropy. Neither can be omitted.
- **Phase transition detector requires CDP time series:** The sign change in cross-correlation between the two entropy series is the phase transition signal. It requires historical CDP data, not just current values.
- **Obstruction-driven reconfiguration requires both Sheaf Cohomology and structural gap detection:** H1 obstruction identifies that reconfiguration is needed; gap detection identifies where to send exploratory agents. Both must exist before the reconfiguration pattern can function.
- **GraphRAG catalyst generation requires Louvain communities:** Catalyst questions are generated in the semantic space of the two communities flanking a structural gap. Without Louvain community membership, gap coordinates have no semantic context for question generation.

---

## MVP Definition

### Launch With (v1)

Minimum viable reference implementation — what is needed to demonstrate all four mathematical properties operating together.

- [ ] **Immutable Store + lcm_grep + lcm_expand** — Foundation of LCM memory guarantee. Everything else depends on deterministic retrieval.
- [ ] **Active Context DAG (SummaryNodes) + Three-level escalation** — The other half of LCM. Without convergence guarantee, long-horizon sessions fail.
- [ ] **Typed shared interfaces (ContextState, GraphTypes, Events)** — Required before any other module compiles. No dependencies.
- [ ] **Stalk spaces + Restriction maps + Sheaf Laplacian** — Minimum viable sheaf-theoretic coordination. Consensus without this is unverifiable.
- [ ] **Sheaf Cohomology H0/H1** — H1 obstruction detection is the differentiating claim. Without it the sheaf implementation is just a fancy graph Laplacian.
- [ ] **TF-IDF preprocessing + 4-gram window + Weighted semantic graph** — Prerequisite for all TNA features.
- [ ] **Louvain community detection + Structural gap detection** — Required for Van der Waals targeting and for GraphRAG question generation.
- [ ] **Von Neumann entropy + Embedding entropy + CDP computation** — Required for SOC monitoring.
- [ ] **Surprising edge ratio tracker** — Required to validate the 12% property during test runs.
- [ ] **llm_map parallel dispatch** — Required to demonstrate the LCM scaling claim over standard RLM symbolic recursion.
- [ ] **AGEMOrchestrator iteration loop** — Required to demonstrate all four components operating together over multiple iterations.
- [ ] **Obstruction-driven graph reconfiguration** — Required to demonstrate the H1-to-exploration feedback loop.

### Add After Validation (v1.x)

Features to add once core mathematical properties are verified against the framework document.

- [ ] **ADMM distributed solver** — Trigger: Sheaf Laplacian proves correct in unit tests; add ADMM for convergence-guaranteed multi-agent consensus with mathematical proof.
- [ ] **Phase transition detector** — Trigger: CDP tracking is stable over 400+ iterations; add correlation sign-change detection.
- [ ] **GraphRAG catalyst question generation** — Trigger: Structural gap detection is producing correct coordinates; add LLM-based bridging question generation.
- [ ] **Force-Atlas layout** — Trigger: Semantic graph construction is validated; add spatial layout for correct gap coordinate generation.
- [ ] **CDP stabilization monitoring and regime validation** — Trigger: Phase transition detector is operational; add alert logic for regime drift.
- [ ] **Betweenness centrality** — Trigger: Semantic graph is stable; add centrality computation for conceptual bottleneck identification.
- [ ] **Molecular CoT bond type classification** — Trigger: Basic orchestration is working; add covalent/hydrogen/Van der Waals reasoning step classification.
- [ ] **SQLite persistence for ImmutableStore** — Trigger: In-memory store proves correct in tests; swap backend to persist across sessions.

### Future Consideration (v2+)

Features to defer until the reference implementation is validated and being used.

- [ ] **Hierarchical compositional reasoning with category-theoretic framing** — Why defer: Requires stable role differentiation between agent types and validated compositional synergy detection. High implementation complexity; defer until base SOC dynamics are proven.
- [ ] **Preferential attachment monitoring and scale-free verification** — Why defer: Requires hundreds of iterations of stable graph growth to observe. Cannot be validated until long-horizon runs are working reliably.
- [ ] **Surprising edge ratio active control** — Why defer: v1 tracks the ratio passively. Active control (deliberately adjusting exploration rate to maintain ~12%) requires a feedback controller — a separate research problem.
- [ ] **Multi-session knowledge graph persistence** — Why defer: Requires schema design for long-lived graph state across restarts. Out of scope until single-session correctness is established.
- [ ] **Embedding model fine-tuning for domain-specific TNA** — Why defer: Generic embedding models are sufficient for demonstrating the mathematical properties. Domain tuning is an application concern, not a reference implementation concern.
- [ ] **Distributed agent execution across machines** — Why defer: In-process Node.js worker threads are sufficient for reference purposes. Distributed execution requires infrastructure that PROJECT.md explicitly excludes from v1.

---

## Feature Prioritization Matrix

| Feature                                           | User Value | Implementation Cost | Priority |
| ------------------------------------------------- | ---------- | ------------------- | -------- |
| Immutable Store + LCM primitives                  | HIGH       | LOW                 | P1       |
| Typed shared interfaces                           | HIGH       | LOW                 | P1       |
| Three-level escalation protocol                   | HIGH       | MEDIUM              | P1       |
| Stalk spaces + Restriction maps + Sheaf Laplacian | HIGH       | HIGH                | P1       |
| Sheaf Cohomology H0/H1                            | HIGH       | HIGH                | P1       |
| TF-IDF + 4-gram window + Semantic graph           | HIGH       | LOW                 | P1       |
| Louvain community detection                       | HIGH       | MEDIUM              | P1       |
| Structural gap detection                          | HIGH       | HIGH                | P1       |
| Von Neumann entropy                               | HIGH       | HIGH                | P1       |
| Embedding entropy                                 | HIGH       | HIGH                | P1       |
| CDP computation                                   | HIGH       | MEDIUM              | P1       |
| Surprising edge ratio tracking                    | HIGH       | MEDIUM              | P1       |
| llm_map parallel dispatch                         | HIGH       | MEDIUM              | P1       |
| AGEMOrchestrator iteration loop                   | HIGH       | MEDIUM              | P1       |
| Obstruction-driven graph reconfiguration          | HIGH       | HIGH                | P1       |
| Betweenness centrality                            | MEDIUM     | MEDIUM              | P2       |
| ADMM distributed solver                           | HIGH       | HIGH                | P2       |
| Force-Atlas layout                                | MEDIUM     | MEDIUM              | P2       |
| Phase transition detector                         | HIGH       | HIGH                | P2       |
| GraphRAG catalyst question generation             | HIGH       | HIGH                | P2       |
| CDP stabilization monitoring                      | MEDIUM     | MEDIUM              | P2       |
| Molecular CoT bond type classification            | HIGH       | HIGH                | P2       |
| SQLite persistence for ImmutableStore             | MEDIUM     | LOW                 | P2       |
| Preferential attachment monitoring                | MEDIUM     | MEDIUM              | P3       |
| Surprising edge ratio active control              | MEDIUM     | HIGH                | P3       |
| Hierarchical compositional reasoning              | HIGH       | HIGH                | P3       |
| Multi-session knowledge graph persistence         | MEDIUM     | HIGH                | P3       |

**Priority key:**

- P1: Must have for launch — required to make mathematical claims verifiable
- P2: Should have — adds significant value after core is working; add when possible
- P3: Nice to have — future consideration once P1 and P2 are validated

---

## Competitor Feature Analysis

| Feature                      | LangGraph                            | AutoGen / AG2                      | CrewAI                             | Mastra / VoltAgent           | This Implementation                                                                      |
| ---------------------------- | ------------------------------------ | ---------------------------------- | ---------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| Persistent memory            | Checkpoint-based, thread-scoped      | context_variables object per agent | ChromaDB + SQLite layers           | Plugin-based memory adapters | Immutable append-only store + DAG SummaryNodes; pointer-based, no data loss              |
| Context overflow handling    | Time travel / replay                 | Manual context truncation          | No built-in escalation             | Framework-dependent          | Three-level escalation with algorithmic fallback; convergence guaranteed                 |
| Multi-agent consensus        | Graph node handoff                   | Conversation turns                 | Sequential or hierarchical process | Supervisor-based             | Sheaf Laplacian diffusion with convergence proof; H1 obstruction detection               |
| Deadlock detection           | None                                 | None                               | None                               | None                         | Sheaf Cohomology H1 group; topological obstruction quantified algebraically              |
| Semantic analysis            | None (RAG is external)               | None (RAG is external)             | None                               | None                         | TNA pipeline: 4-gram, Louvain, betweenness centrality, structural gap detection          |
| Knowledge gap identification | None                                 | None                               | None                               | None                         | Structural gap detection over Louvain community boundaries; GraphRAG catalyst generation |
| Criticality monitoring       | None                                 | None                               | None                               | None                         | Von Neumann entropy + embedding entropy + CDP + surprising edge ratio + phase transition |
| TypeScript support           | Limited (Python-first)               | Limited (Python-first)             | Limited (Python-first)             | Native TypeScript            | Native TypeScript                                                                        |
| Horizontal scaling           | LangGraph cloud + partitioned graphs | Group chat scaling                 | Crew parallelism                   | Agent supervisor tree        | llm_map primitive; parallel sub-task dispatch across worker agents                       |
| Observability                | LangSmith tracing                    | OpenTelemetry (AG2 2026)           | Task replay                        | Framework-dependent          | Event bus provides all inter-component signals; plug-in OpenTelemetry as consumer        |
| Open-source                  | Yes                                  | Yes                                | Yes                                | Yes                          | Yes (reference implementation)                                                           |

---

## Sources

- Framework primary document: `docs/RLM-LCM-Molecular-CoT-Group-Evolving-Agents.md`
- LCM paper: Voltropy — [https://papers.voltropy.com/LCM](https://papers.voltropy.com/LCM); [arXiv:2602.22402](https://arxiv.org/abs/2602.22402)
- Applied Sheaf Theory for Multi-Agent AI: [arXiv:2504.17700](https://arxiv.org/abs/2504.17700)
- Distributed Multi-Agent Coordination over Cellular Sheaves: [arXiv:2504.02049](https://arxiv.org/html/2504.02049v1)
- InfraNodus TNA methodology: [https://infranodus.com/docs/text-network-analysis](https://infranodus.com/docs/text-network-analysis); [InfraNodus API](https://infranodus.com/api)
- LangGraph vs AutoGen vs CrewAI comparison: [DataCamp](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen); [Latenode](https://latenode.com/blog/platform-comparisons-alternatives/automation-platform-comparisons/langgraph-vs-autogen-vs-crewai-complete-ai-agent-framework-comparison-architecture-analysis-2025)
- TypeScript agent frameworks: [Mastra](https://mastra.ai/); [VoltAgent](https://voltagent.dev/blog/typescript-ai-agent-framework/); [Google ADK for TypeScript](https://developers.googleblog.com/introducing-agent-development-kit-for-typescript-build-ai-agents-with-the-power-of-a-code-first-approach/)
- Agent observability: [OpenTelemetry AI Agent Observability](https://opentelemetry.io/blog/2025/ai-agent-observability/); [AG2 OpenTelemetry](https://docs.ag2.ai/latest/docs/blog/2026/02/08/AG2-OpenTelemetry-Tracing/)
- Table stakes for multi-agent observability: [SoftwareSeni](https://www.softwareseni.com/why-observability-is-table-stakes-for-multi-agent-systems-in-production-environments/)
- Multi-agent framework landscape 2025-2026: [Shakudo](https://www.shakudo.io/blog/top-9-ai-agent-frameworks); [adopt.ai](https://www.adopt.ai/blog/multi-agent-frameworks); [Google Developers Blog](https://developers.googleblog.com/architecting-efficient-context-aware-multi-agent-framework-for-production/)
- Architecture research (prior): `.planning/research/ARCHITECTURE.md`

---

_Feature research for: RLM-LCM Molecular-CoT Group Evolving Agents — TypeScript/JavaScript reference implementation_
_Researched: 2026-02-27_
