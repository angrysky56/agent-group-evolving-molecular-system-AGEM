# Agent Group Evolving Molecular System (AGEM)

> [!TIP]
> **TL;DR**: AGEM is a self-contained TypeScript reasoning engine. It ingests text into an evolving concept graph, tracks how that graph fragments and coheres (sheaf **H⁰**), measures whether the system is still developing or has prematurely converged (self-organized criticality), and — its distinctive capability — detects genuine **logical contradiction** in a body of claims by computing the homology of a _consistency complex_ backed by a real theorem prover (**logic-based H¹**).

## Quick-Start Card

| Goal              | Action                             | Target                             |
| :---------------- | :--------------------------------- | :--------------------------------- |
| **Launch System** | `./start.sh`                       | Full-stack UI + Backend            |
| **Run Analysis**  | Open `localhost:5173`              | Interactive Chat Dashboard         |
| **Add Knowledge** | Drop `.md` in `skills/`            | Agent Skill Loading                |
| **Run Tests**     | `npm test`                         | Core Engine Validation             |
| **Inspect a run** | Read `knowledge_base/runs/<id>.md` | Full tool I/O + graph-ingest trace |
| **Benchmark**     | `npx tsx benchmarks/phase-timing.bench.ts` | Per-phase cycle cost vs graph size |

## What AGEM does

AGEM is a single, self-contained engine. The core (`src/`) has **no external service dependencies** — it runs on its own. The chat interface adds one genuinely useful external reasoning tool (`mcp-logic`, a Prover9/Mace4 wrapper) and can optionally reach other MCP servers, but nothing in the engine requires them.

Each reasoning cycle ingests text into a persistent, accumulating concept graph and computes a small set of **honestly-scoped** metrics:

- **Graph topology (TNA)** — concept communities (Louvain) and the bridges between them. The richest signal: which ideas cluster and how they connect.
- **Sheaf H⁰ — connectivity / fragmentation.** H⁰ is the number of connected semantic components. Rising H⁰ means the discussion is fragmenting into separate topic-islands; falling H⁰ means a new idea bridged previously separate clusters. This is the geometric sheaf's real, reliable contribution.
- **Self-Organized Criticality (SOC)** — von Neumann entropy, embedding entropy, CDP, and a regime classifier (nascent / stable / critical). A measure of how much the graph is still developing, and a detector for "conclusion precedes logic" (embedding entropy stabilizing before structural entropy). VNE is computed exactly on small graphs and via the linear-time **FINGER** approximation once the graph outgrows a dense eigendecomposition — see [Scaling: linear-time graph entropy](#scaling-linear-time-graph-entropy).
- **Minimal unsatisfiable sets — genuine contradiction detection.** See below. This is AGEM's distinctive capability.

> [!IMPORTANT]
> **A note on metric honesty.** The _geometric_ sheaf's H¹ reflects cycle topology in the cluster graph — it does **not** detect logical contradiction (real embeddings saturate the coboundary rank, so geometric H¹ ≈ 0 regardless of content). AGEM does not pretend otherwise. Contradiction is detected by the _separate_ logical pipeline described next. H⁰ is for connectivity; the logical search is for contradiction; the two are different machines.
>
> The same discipline applies inside that logical pipeline. Its own H¹ turned out to be an unreliable detector — pinned at 0 for any realistic number of blocks — so the detector is now the minimal-unsatisfiable-set search, and H¹ is demoted to a summary with its failure modes documented. See the warning below.

## Contradiction detection — the distinctive capability

The question "are these claims actually consistent?" cannot be answered by graph geometry — similarity is not consistency ("collapse is real" and "collapse is not real" are nearly identical vectors and flatly contradictory). AGEM answers it logically, by searching for **minimal unsatisfiable sets**:

- Each **block** of claims is a vertex.
- A set of blocks is tested for joint satisfiability only once every one of its proper subsets is known consistent — every check delegated to `mcp-logic` (Prover9/Mace4).
- A set that fails that test is a **frustration**: its members cannot all be true together, yet every proper subset can. Minimality is guaranteed by the search order, so each one names an irreducible contradiction rather than a superset of one.
- The search runs to **arity 4 by default** (configurable), so it catches Bell-shaped tensions — any three assumptions compatible, all four impossible — not just frustrated triples.

This is exposed as the `evaluate_logical_consistency` tool. The agent supplies blocks and their claims as first-order-logic propositions; the **engine** orchestrates all the satisfiability checks (so they can't be malformed) and returns a plain-language `verdict`, `hasContradiction`, the offending `frustrations` with their arity, and a full `checkLog` audit trail of every check run and its verdict.

> [!WARNING]
> **Do not read H¹ as the contradiction detector.** It is still computed and still reported, but it is a topological summary of the complex and it has two false-negative modes, both verified against this implementation:
>
> 1. **Extra consistent blocks cancel it.** With n ≥ 4 blocks, a single genuine frustrated triple gives H¹ = 0 — the other filled simplices span the cycle space, so the unfilled one becomes a boundary rather than a cycle. Measured: n=3 → H¹=1; n=4, 5, 6, 8 → H¹=0, same frustration present throughout.
> 2. **It cannot see above arity 3.** A 4-block minimal unsatisfiable set has every triple satisfiable, so every triangle fills and H¹ = 0.
>
> Since real runs name blocks from concept communities and so almost always have four or more, **H¹ was pinned at 0 in practice and fired only on the 3-block calibration corpus.** The math was never wrong; the interpretation was. `hasContradiction` and `frustrations` are the signal — `h1Note` is emitted whenever H¹ = 0 while frustrations exist, so the discrepancy is explained rather than discovered.
>
> H⁰ remains a fine connectivity readout, with the same caveat it always had: a block consistent with both sides of a flat contradiction bridges them in the graph without touching the contradiction.

It is verified end-to-end: the homology against a Python reference, the satisfiability against real Mace4, and the live pipeline against calibrated corpora in `docs/logic-corpus/`. Regression tests pin the behaviour that matters — the frustration is found regardless of how many extra consistent blocks accompany it, 4-wise frustrations are found, minimality is enforced, and truncated searches admit it. See `docs/emergent-bonds-and-stateless-reconstruction.md` §13–§15 for the original derivation.

Two corpora ship with it:

- `logic-h1-test-corpus.md` — the calibration instrument: atomic propositions, known answers, proves the machinery runs.
- `generalization-trilemma-corpus.md` — a **trap corpus**: four staged cycles of sincere, self-contained positions in a live research disagreement, with the contradiction never stated. The vocabulary clusters deliberately crosswise to the logic, one passage is a near-neighbour in embedding space with no logical bearing, and the final stage is a synthesis that bridges vocabulary and resolves nothing. Answer key in `generalization-trilemma-KEY.md` — do not feed that one to the model.

## Native tools

AGEM exposes its own capabilities as tools any connected LLM agent calls directly:

- **`run_agem_cycle`** — ingest text into the accumulating concept graph and run a full analysis pass. A cycle only advances the graph if fed _new, substantive_ content.
- **`get_graph_topology`** — concept communities and inter-community bridges (the primary inspection tool).
- **`get_cohomology`** — geometric sheaf H⁰/H¹ (connectivity; see the honesty note above).
- **`evaluate_logical_consistency`** — **logic-based H⁰/H¹** contradiction detection (the distinctive capability).
- **`get_soc_metrics`** — SOC metrics and regime classification.
- **`detect_gaps` / `generate_catalyst_questions`** — structural gaps and the questions that would bridge them.
- **`search_context`** — semantic search over the LCM store.
- **`get_agem_state`, `spawn_agem_agent`, `reset_agem_engine`, `read_skill`** — state, lifecycle, and skill management.

## Formal logic dependency — mcp-logic

The one external reasoning tool AGEM relies on for contradiction detection is [`mcp-logic`](https://github.com/angrysky56/mcp-logic), a wrapper around the LADR Prover9/Mace4 theorem prover. The relevant tools:

- **`prove`** — does a conclusion follow from premises? (field is `conclusion`, not `goal`)
- **`find_counterexample`** — a model where premises hold but the conclusion fails; with `conclusion="$F"` this is the satisfiability/consistency check the consistency complex is built on.
- **`check_well_formed`** — syntax-check formulas.

Formulas use ASCII first-order logic: `->` `<->` `&` `|` `-` (negation), parenthesized quantifiers (`all x (p(x) -> q(x))`), one formula per array element. `mcp-logic` normalizes `~`→`-` and reports a clean Mace4 exhaustion as "no model" rather than a false timeout (both fixed at the source; see that repo's regression tests).

## TypeDB claim store (optional)

The concept graph records that two lemmas appeared near each other. It cannot record that IIT **excludes** global broadcast — so a formalizer reading it has to *reconstruct* the claim from keywords, and reconstruction is underdetermined. Measured on one corpus across three runs: 3, then 6, then 2 contradictions, with IIT/GWT flipping from contradictory to consistent because the exclusion silently vanished from the encoding.

The claim store fixes the shape rather than the wording. Claims are stored as **schema-enforced n-ary relations with named roles and mandatory provenance** (`schema/claims.tql`), so a malformed extraction *fails to write* instead of becoming a confident wrong answer:

```
exclusion missing its `excluded` role  →  [CNT5]  Constraint '@card(1..1)' violated: found 0 instances
                                          [DVL11] relation 'exclusion' has a relates constraint violation
causal-claim with no polarity          →  [DVL10] attribute ownership constraint violation
claim with no source segment           →  [CNT5]  Constraint '@card(1..)' violated
```

**AGEM runs fine without it.** If no server is reachable the store disables itself, logs what to do, and reasoning continues on the concept graph alone. Set `TYPEDB_ENABLED=false` to silence the warning.

### Setup

```bash
curl -sSL https://typedb.com/install.sh | sh && export PATH="$HOME/.typedb:$PATH"

# TypeDB defaults HTTP to 8000, which collides with AGEM's own backend PORT.
typedb server --server.http.listen-address 0.0.0.0:8100
```

Nothing else is required — the backend creates the database and defines the schema on boot, idempotently. Verify with:

```bash
cd interface/backend && npx tsx scripts/verify-claim-store.ts
```

**Driver note.** TypeDB 3.x has no gRPC driver for Node; the npm package `typedb-driver` is 2.x-only and will *not* talk to a 3.x server. AGEM uses `@typedb/driver-http`, and `TYPEDB_ADDRESS` is therefore the **HTTP** port (8100), not gRPC 1729.

**Writing TypeQL.** TypeDB 3.x is a rewrite — `thing` is no longer a root type, inserts use `links (role: $x)`, and queries are pipelines. The vendored reference at `skills/typeql/SKILL.md` raises TypeQL pass rates from 23–43% to 86–96% by TypeDB's own benchmark; use it rather than writing 3.x from memory. Optionally add the syntax checker with `sudo apt install typeql-check=3.12.0` (pin the version — apt's default candidate `3.12.0-rc0` is a truncated artifact on their CDN at time of writing). It isn't needed: loading a schema against a scratch database validates semantics as well as grammar.

## Run logging & observability

Every run writes a complete, readable trace to `knowledge_base/runs/<timestamp>_<id>.jsonl` and a `.md` transcript alongside it: the **exact text fed into the graph each cycle**, the **full input and output of every tool call** (including the `checkLog` from `evaluate_logical_consistency`), and a run-end summary. The run-log id is also surfaced in tool output. This makes after-the-fact debugging a matter of reading one file rather than reconstructing from terminal scrollback.

## Scaling: linear-time graph entropy

Von Neumann entropy was originally computed by eigendecomposing a dense n×n normalized Laplacian — O(n³) time, O(n²) memory. Because AGEM's graph is **persistent and accumulates across every cycle of a session**, that cost is not per-corpus but per-cycle and rising. Measured (`benchmarks/phase-timing.bench.ts`): 382 nodes → **14.5 s per cycle**, scaling as ≈n^3.3, so ~800 nodes → ~2.8 min and ~2000 nodes → ~57 min. A session ingesting a few real corpora would stall.

AGEM now uses **FINGER** ([Chen et al., ICML 2019](#references)) above a configurable node threshold, replacing the whole eigenspectrum with a single trace:

```
Q = 1 − tr(ρ²)          Ĥ = −Q · ln λ_max          both O(n + m)
```

| nodes | before | after |
| ----: | -----: | ----: |
|   382 | 14 498 ms | **19.8 ms** |
|   682 | ~64 s | **15.0 ms** |
|  2082 | ~57 min | **84.3 ms** |

**This is a re-derivation, not a transcription.** FINGER publishes its closed form for the _combinatorial_ Laplacian scaled by its trace; AGEM uses the _symmetric normalized_ Laplacian `I − D^(−1/2) A D^(−1/2)`. Applying the published formula directly would have silently computed a different quantity that still looked plausible. What generalises is the identity `Q = 1 − tr(ρ²)`; only the closed form for `tr(ρ²)` is matrix-specific. The AGEM derivation is anchored on Kₙ (`Q = (n−2)/(n−1)`, `λ_max(ρ) = 1/(n−1)`) and every accuracy test asserts against the **real exact solver**, not hand-copied numbers.

Properties that made it safe to adopt, all under test in `src/soc/fingerEntropy.test.ts`:

- **Lower bound on the exact value** — the metric errs conservative, never over-claiming structure.
- **Error shrinks as the graph grows** — relative error `1/(n−1)` on Kₙ; most accurate exactly where it is needed.
- **Deterministic** — fixed power-iteration start vector, never `Math.random`, matching the seeded-Louvain precedent.
- **Ordering preserved** — SOC reads VNE as a trend, so monotonicity matters more than absolute value.

> [!NOTE]
> Because FINGER is a lower bound, crossing the threshold **steps the VNE series down**, and SOC's rolling correlation and regime classifier read trends — an unexplained step could register as a phantom phase transition. So on the single iteration where the switch happens, `SOCTracker` also computes the exact value and logs the offset (`getApproximationOffset()`). The discontinuity is a measured number, not a surprise.

Threshold: `SOCConfig.exactEntropyMaxNodes` (default 250). Below it the exact solver is cheap enough to be worth the fidelity. Full write-up in `docs/tool-execution-controllability.md`.

### What it unlocked: entropy centrality

Making VNE cheap made a second measure affordable — `src/soc/entropyCentrality.ts`, the dyadic core of [Hu, Tian & Zhang](#references). Rank a concept by how much entropy the graph loses when it is removed: `score(v) = Θ(G) − Θ(G∖v)`. Ranking every node needs _n_ entropy computations, so against the dense solver this was O(n⁴) — 43 s for a 120-node graph, hours at real sizes. It now runs in **15 ms at 2000 nodes**, via an incremental update that re-prices only the edges touching a removed node's neighbourhood.

Measured against the exact dense solver (Spearman rank correlation, hub-heavy graph):

| signal | ρ vs exact ΔΘ | distinct values / 120 |
| --- | ---: | ---: |
| **ΔQ** | **0.99** | **120** |
| ΔĤ (full FINGER estimate) | 0.14 | — |
| degree centrality | 0.12 | 16 |

Two results worth recording. **Rank by `Q`, not by `Ĥ`** — the obvious move is to use the better entropy estimate `Ĥ = −Q·ln λ_max`, and it fails, because λ_max shifts from node to node and swamps the ordering. The source paper reaches for the quadratic approximation for _speed_ and notes it costs accuracy; on this evidence it is also the more faithful _ranking_ signal, which is an argument the paper does not make. And **degree centrality ties badly** — 16 distinct values across 120 nodes, so it cannot order within its buckets, while ΔQ separates all 120.

Scope, honestly: this is a **structural** measure, not a semantic one — a function word that slips past the preprocessor's noise filters will score highly, and deserves to by this metric. It is currently a measured signal with tests, **not yet wired into any tool**; the natural use is seeding `detect_gaps` / `generate_catalyst_questions` with load-bearing concepts instead of degree. The source paper's hypergraph machinery (s-line graphs, hyperedge-cardinality weighting) does **not** apply to AGEM's dyadic graph and is not implemented, and its evaluation validates epidemic-propagation influence rather than importance in a reasoning graph — so the numbers above were measured here against this repo's exact solver rather than inherited.

## Tool execution: bounded recovery and side-effect-aware dispatch

The chat tool loop has an explicit controllability layer rather than leaving failure handling to the model's judgement. Design vocabulary from [Hu Wei's scheduler-theoretic framework](#references); its central prescription — the static DAG — was **deliberately rejected**, since that paper disqualifies its own architecture for open-ended exploration and dynamic goal evolution, which is precisely AGEM's domain. Only the controllability primitives transferred.

- **Bounded three-level recovery** (`recovery-protocol.ts`) — L1 engine-side retry for transient faults (network, timeout, rate limit, 5xx), L2 deterministic argument repair for schema faults, L3 escalation to the model. The escalation invariant is enforced mechanically by a per-call `pristine → retried → patched` counter, not by convention. Replaces an unbounded loop whose only rule was the words "retry ONCE" in a prompt.
- **Non-idempotent calls are never blind-retried** — `run_agem_cycle` ingests into the accumulating graph, so a silent retry would double-count the same co-occurrences. Those failures escalate with a notice saying why.
- **Context partition** — full failure detail (stack, response body, every attempt) goes to the run log only. Chat history receives a terse, length-capped, structured notice. Failure text never becomes implicit input to later reasoning, and never reaches the concept graph.
- **Side-effect-aware parallel dispatch** (`tool-dispatch.ts`) — consecutive read-only calls run concurrently; every mutating call is a wave of its own, so read/write order is preserved and results return in original call order. Unknown tools default to *mutating*: misclassifying a read as a write costs latency, the reverse corrupts the graph.
- **Output contract** (`workflow-contract.ts`) — a run completes when the workflow demonstrably happened (ingest → inspect → verify-if-multi-position), not when a turn counter says so. "Multi-position" is read from AGEM's own clustering (≥2 concept communities), not keyword-matched. Only *successful* calls count. Stays dormant on non-analysis runs, so "reset the engine" is never nudged to ingest a corpus it does not have.

## Optional MCP servers

AGEM does not require any MCP server other than `mcp-logic` (for contradiction detection). The meta-tools `list_mcp_servers`, `list_server_tools`, and `call_mcp_tool` let an agent reach any other server configured in `mcp.json` — useful utilities include `fetch`, `sqlite`, `memory`, `desktop-commander`, `playwright`, and `docker`. Other reasoning servers may be configured but are experimental and are not part of the standard workflow.

> [!NOTE]
> Earlier versions of AGEM were wired to an external "EFHF" suite of MCP servers (a second sheaf enforcer, an ethical-tier evaluator, a world-model, etc.). That coupling caused real confusion — notably _two independent sheaf systems_ claiming the same job — and was never actually wired into the engine (the bridge class was defined but never instantiated). AGEM is now self-contained: the engine computes its own H⁰, `mcp-logic` provides contradiction detection, and everything else is optional. If you are looking for the EFHF servers, they live in their own repositories. [Emergent Functional Hierarchies Framework](https://github.com/angrysky56/Emergent-Functional-Hierarchies-Framework)

## Key Features

- **Logic-based contradiction detection** — the consistency-complex H¹ pipeline (above), verified end-to-end against a real theorem prover.
- **Sheaf H⁰ connectivity** — `CellularSheaf` + `CohomologyAnalyzer` track how the concept graph fragments and coheres via SVD of the coboundary operator.
- **Text Network Analysis (TNA)** — co-occurrence graph, Louvain community detection, centrality, structural gap detection, ForceAtlas2 layout, catalyst-question generation.
- **Self-Organized Criticality (SOC)** — CDP, VNE, EE, SER tracking with phase-transition detection, regime classification, and System-1 ("conclusion precedes logic") detection via `RegimeValidator`.
- **Linear-time graph entropy (FINGER)** — O(n+m) von Neumann entropy above a node threshold, replacing an O(n³) dense eigendecomposition; 382-node cycles went 14.5 s → 19.8 ms, and previously-impossible 2000-node graphs now cost 84 ms.
- **Entropy centrality** — ranks concepts by the entropy the graph loses without them (ρ≈0.99 against the exact solver, where degree centrality manages 0.12 and ties 120 nodes into 16 buckets). Measured signal with tests; not yet wired into any tool.
- **Bounded tool recovery** — three-level escalation (retry → patch → escalate) with the invariant enforced by a per-call state counter, non-idempotent calls protected from silent retry, and full failure detail kept out of chat history and the concept graph.
- **Side-effect-aware tool dispatch** — read-only tools run concurrently, mutating tools serially and in order; unknown tools default to the safe side.
- **Workflow output contract** — completion validated against what the run actually did, not a turn counter, and dormant on non-analysis runs.
- **Lifecycle Context Model (LCM)** — append-only immutable store, embedding cache, hierarchical summary DAG, and a three-level escalation protocol with guaranteed convergence.
- **Lumpability auditing** — `LumpabilityAuditor` detects information loss at LCM compaction boundaries by comparing embedding-entropy profiles of source entries vs summary nodes.
- **Molecular Chain-of-Thought** — reasoning topology using covalent (strong dependency), hydrogen (self-reflection), and Van der Waals (exploration) bond metaphors.
- **Run logging** — full per-run trace (graph inputs + tool I/O) to `knowledge_base/runs/`.
- **Full-stack chat interface** — React + Express with SSE streaming, session history, knowledge-base persistence, and a real-time system dashboard (vitals strip, SOC sparklines, event log, graph visualization).
- **Meta-Tool MCP Access** — 3 meta-tools give models dynamic access to any configured MCP server without flooding context with raw schemas.
- **Provider Embeddings** — `ProviderEmbedder` calls Ollama or OpenRouter for real semantic similarity, with dimension-aware fallback.
- **Tri-Provider LLM Support** — Ollama (local), OpenRouter (cloud), and Anthropic, with provider-correct tool-calling formats.
- **Agent Skills System** — YAML-frontmatter `.md` skills loaded natively into the prompt.

## Tech Stack

### Core Engine

- **Language**: [TypeScript](https://www.typescriptlang.org/) (ES2022) · **Runtime**: [Node.js](https://nodejs.org/) v20+
- **Mathematics**: [mathjs](https://mathjs.org/), [ml-matrix](https://github.com/mljs/matrix)
- **NLP**: [natural](https://github.com/NaturalNode/natural), [wink-lemmatizer](https://winkjs.org/), [stopword](https://github.com/fergiemcdowall/stopword)
- **Graph Theory**: [graphology](https://graphology.github.io/) (Louvain, Metrics, Layout)
- **Testing**: [Vitest](https://vitest.dev/)

### Interface

- **Backend**: [Express](https://expressjs.com/) + SSE streaming
- **Frontend**: [React](https://react.dev/) + [Vite](https://vite.dev/) + TypeScript
- **State**: [Zustand](https://zustand.docs.pmnd.rs/)
- **LLM Providers**: Ollama (local), OpenRouter (cloud), Anthropic, MiniMax

## Project Structure

```
agent-group-evolving-molecular-system-AGEM/
├── src/                       # Core AGEM engine (self-contained, no external deps)
│   ├── orchestrator/          #   Central coordination + obstruction handling
│   ├── sheaf/                 #   CellularSheaf + CohomologyAnalyzer (geometric H⁰/H¹)
│   ├── tna/                   #   Text Network Analysis pipeline
│   ├── soc/                   #   Self-Organized Criticality tracker
│   │   ├── entropy.ts         #     Exact VNE + embedding entropy
│   │   ├── fingerEntropy.ts   #     FINGER linear-time VNE (O(n+m))
│   │   └── entropyCentrality.ts #   ΔQ node importance (entropy held up)
│   ├── lcm/                   #   Lifecycle Context Model
│   ├── lumpability/           #   Lumpability auditing
│   └── types/                 #   Shared type definitions + events
├── interface/                 # Full-stack chat interface
│   ├── backend/src/services/  #   LLM providers, agem-bridge, logicalCohomology, run-logger, MCP manager
│   │   ├── recovery-protocol.ts  #  Bounded three-level tool recovery
│   │   ├── tool-dispatch.ts      #  Side-effect classification + parallel dispatch
│   │   └── workflow-contract.ts  #  Output contract κ for run completion
│   ├── frontend/              #   React + Vite dashboard
│   └── shared/                #   FE ↔ BE type contract
├── benchmarks/                # Phase-timing benchmark (settles perf questions with data)
├── cli/                       # Interactive terminal REPL (thin HTTP client)
├── skills/                    # YAML-frontmatter agent skill definitions
├── docs/
│   ├── emergent-bonds-and-stateless-reconstruction.md  # Logic-H¹ derivation + verification (§13–15)
│   ├── tool-execution-controllability.md               # Recovery/contract layer + FINGER derivation
│   └── logic-corpus/          # Calibrated test corpus for logic-based H¹
├── knowledge_base/runs/       # Per-run traces (graph inputs + full tool I/O)
└── mcp.json                   # MCP server configuration (mcp-logic + optional utilities)
```

## Getting Started

### 1. Clone & Install

```bash
git clone https://github.com/angrysky56/agent-group-evolving-molecular-system-AGEM.git
cd agent-group-evolving-molecular-system-AGEM
npm install
```

Approve native lifecycle scripts required by dependencies (`onnxruntime-node`, `protobufjs`, `esbuild`, `sharp`):

```bash
npm install-scripts approve onnxruntime-node protobufjs esbuild sharp
```

### 2. Install mcp-logic (for contradiction detection)

Only one external server is needed for the logic-based H¹ capability:

```bash
cd ..  # parent directory of AGEM
git clone https://github.com/angrysky56/mcp-logic.git
# follow mcp-logic's README — it uses uv and vendors the LADR Prover9/Mace4 binaries
```

The core engine and graph/SOC analysis run without it; only `evaluate_logical_consistency` requires it.

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env — set LLM_PROVIDER, API keys, model names
```

### 4. Configure MCP

```bash
cp mcp.json.example mcp.json
# Edit mcp.json — set the path to your mcp-logic checkout (and any optional utility servers)
```

### 5. Run the Tests

```bash
npm test
```

### 6. Start the Interface

```bash
./start.sh            # full stack; frontend at http://localhost:5173
# ./start.sh --backend / --frontend / --install
```

## Configuration

All configuration lives in `.env`. Key settings:

| Variable                 | Default                           | Description                                           |
| ------------------------ | --------------------------------- | ----------------------------------------------------- |
| `LLM_PROVIDER`           | `ollama`                          | Active provider (`ollama`, `openrouter`, `anthropic`) |
| `OLLAMA_BASE_URL`        | `http://localhost:11434`          | Ollama API endpoint                                   |
| `OLLAMA_MODEL`           | `gemma3:latest`                   | Ollama chat model                                     |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text:latest`         | Ollama embedding model                                |
| `OPENROUTER_API_KEY`     | —                                 | OpenRouter API key                                    |
| `OPENROUTER_MODEL`       | `google/gemini-2.5-flash-preview` | OpenRouter chat model                                 |
| `PORT`                   | `8000`                            | Backend server port                                   |

Tool-execution settings:

| Variable                         | Default | Description                                                                                                    |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `CHAT_MAX_TURNS`                 | `30`    | Hard cap on tool turns per request.                                                                             |
| `TOOL_RETRY_BUDGET`              | `2`     | L1 retries for **transient** faults on **idempotent** calls only. `0` escalates every failure to the model.      |
| `TOOL_MAX_CONCURRENCY`           | `4`     | Max simultaneous read-only tool calls. Mutating tools are always serial regardless of this value.                |
| `CHAT_ENFORCE_WORKFLOW_CONTRACT` | `true`  | Require ingest → inspect → verify-if-multi-position before a run may finish.                                    |
| `CHAT_CONTRACT_MATERIAL_CHARS`   | `600`   | User-message size at which a run counts as an analysis, so short maintenance commands are never nudged.          |

Engine setting (`SOCConfig`, not env): `exactEntropyMaxNodes` (default `250`) — node count above which VNE switches from the exact solver to FINGER.

## Architecture

```
User Prompt → Orchestrator.runReasoning()
    │
    ├─→ TNA: preprocess → co-occurrence graph → Louvain → centrality → gaps
    ├─→ LCM: append to ImmutableStore → ProviderEmbedder → embedding cache
    ├─→ Sheaf: cohomology analysis → H⁰ (connectivity / fragmentation)
    ├─→ SOC: VNE + EE + CDP + SER → phase transitions → regime
    ├─→ Lumpability: audit compaction → entropy ratio → strong/weak classification
    │
    ├─→ evaluate_logical_consistency: blocks → mcp-logic satisfiability checks
    │   → consistency complex → logic-based H⁰/H¹ + checkLog
    │
    ├─→ Dashboard SSE: /api/v1/system/events → vitals + sparklines + event log
    └─→ Run logger: knowledge_base/runs/<id>.{jsonl,md}
```

All events flow through the central `EventBus`; modules communicate via typed events. Each engine module (sheaf, lcm, tna, soc, lumpability) has **zero cross-imports** — statically enforced by isolation tests — and only `ComposeRootModule` may import from multiple modules.

## Available Scripts

| Command              | Description                         |
| -------------------- | ----------------------------------- |
| `npm run build`      | Compile the TypeScript core engine. |
| `npm test`           | Run the full Vitest suite.          |
| `npm run test:watch` | Vitest in watch mode.               |
| `npm run typecheck`  | TypeScript compiler, no emit.       |

Benchmark (not part of the test suite):

```bash
npx tsx benchmarks/phase-timing.bench.ts   # per-phase cycle cost vs graph size
```

## References

Work AGEM builds on directly. Where an idea was adapted rather than adopted wholesale, the difference is stated — the adaptations are AGEM's responsibility, not the original authors'.

**FINGER — linear-time von Neumann graph entropy**
Pin-Yu Chen, Lingfei Wu, Sijia Liu, Indika Rajapakse. *Fast Incremental von Neumann Graph Entropy Computation: Theory, Algorithm, and Applications.* ICML 2019. [arXiv:1805.11769](https://arxiv.org/abs/1805.11769)

> Used for `src/soc/fingerEntropy.ts`. The quadratic-approximation insight — collapse the eigenspectrum into `Q = 1 − tr(ρ²)` and pair it with `λ_max` alone — is entirely theirs, and it is what turns an O(n³) metric into an O(n+m) one. **Adaptation:** the paper's closed form is derived for the combinatorial Laplacian scaled by its trace; AGEM's VNE is defined over the symmetric normalized Laplacian, so the closed form for `tr(ρ²)` was re-derived for that matrix and validated against AGEM's exact solver. Their Theorem 2 incremental update is not implemented — recomputing `Q` is already microseconds at these sizes. Any error in the re-derivation is ours.

**Entropy-based vital node identification**
Feng Hu, Kuo Tian, Zi-Ke Zhang. *Identifying Vital Nodes in Hypergraphs Based on Von Neumann Entropy.* Entropy 25(9), 1263, 2023. [doi:10.3390/e25091263](https://doi.org/10.3390/e25091263)

> Basis for `src/soc/entropyCentrality.ts`. The criterion taken is theirs: rank a node by the drop in von Neumann entropy when it is removed, and use the quadratic approximation to make that affordable. **Not adopted:** the hypergraph machinery (s-line graph projection, hyperedge-cardinality weighting) — AGEM's TNA graph is dyadic, so it has nothing to act on. **Diverging finding:** they use the quadratic approximation as a speed/accuracy tradeoff and report it slightly underperforms exact HVC; measured here, ranking by the bare quadratic term `Q` tracks the exact entropy drop at ρ≈0.99 while ranking by the fuller estimate `Ĥ` collapses to ρ≈0.14, so for ranking it is not a tradeoff but the better choice. Their evaluation targets epidemic-propagation influence, which is not AGEM's use case and is not carried over as evidence.

**Scheduler-theoretic framework for LLM agent execution**
Hu Wei. *From Agent Loops to Structured Graphs: A Scheduler-Theoretic Framework for LLM Agent Execution.* 2026. [arXiv:2604.11378](https://arxiv.org/abs/2604.11378)

> Provided the vocabulary and the design discipline for the tool-execution layer: bounded three-level recovery with a mechanically enforced escalation invariant, execution/diagnostic context partition, output-contract validation, and side-effect classification. **Deliberately not adopted:** the paper's central prescription, the static pre-planned DAG. Its own §9.7 and §10.2 disqualify that architecture for open-ended exploration and dynamic goal evolution — which is exactly what AGEM does — so only the controllability primitives, which are orthogonal to static planning, were taken. Note also that the paper is a position paper: it states plainly that its performance predictions are untested, and nothing here treats them as evidence.

**Formal logic**
Prover9/Mace4 (LADR), William McCune — the theorem prover and model finder underneath every satisfiability check in the consistency complex, via [`mcp-logic`](https://github.com/angrysky56/mcp-logic).

## License

MIT (or check `LICENSE` file if present)
