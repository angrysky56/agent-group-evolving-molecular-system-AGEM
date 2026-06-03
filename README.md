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

## What AGEM does

AGEM is a single, self-contained engine. The core (`src/`) has **no external service dependencies** — it runs on its own. The chat interface adds one genuinely useful external reasoning tool (`mcp-logic`, a Prover9/Mace4 wrapper) and can optionally reach other MCP servers, but nothing in the engine requires them.

Each reasoning cycle ingests text into a persistent, accumulating concept graph and computes a small set of **honestly-scoped** metrics:

- **Graph topology (TNA)** — concept communities (Louvain) and the bridges between them. The richest signal: which ideas cluster and how they connect.
- **Sheaf H⁰ — connectivity / fragmentation.** H⁰ is the number of connected semantic components. Rising H⁰ means the discussion is fragmenting into separate topic-islands; falling H⁰ means a new idea bridged previously separate clusters. This is the geometric sheaf's real, reliable contribution.
- **Self-Organized Criticality (SOC)** — von Neumann entropy, embedding entropy, CDP, and a regime classifier (nascent / stable / critical). A measure of how much the graph is still developing, and a detector for "conclusion precedes logic" (embedding entropy stabilizing before structural entropy).
- **Logic-based H¹ — genuine contradiction detection.** See below. This is AGEM's distinctive capability.

> [!IMPORTANT]
> **A note on metric honesty.** The _geometric_ sheaf's H¹ reflects cycle topology in the cluster graph — it does **not** detect logical contradiction (real embeddings saturate the coboundary rank, so geometric H¹ ≈ 0 regardless of content). AGEM does not pretend otherwise. Contradiction is detected by the _separate_ logic-based H¹ pipeline described next. H⁰ is for connectivity; logic-H¹ is for contradiction; the two are different machines.

## Logic-based H¹ — the distinctive capability

The question "are these claims actually consistent?" cannot be answered by graph geometry — similarity is not consistency ("collapse is real" and "collapse is not real" are nearly identical vectors and flatly contradictory). AGEM answers it with a genuinely logical construction, the **consistency complex**:

- Each **block** of claims is a vertex.
- A set of blocks is a "filled" simplex iff their combined propositions are **jointly satisfiable** — every such check is delegated to `mcp-logic` (Prover9/Mace4).
- **H⁰** of this complex = groups of blocks that cannot even pairwise reconcile.
- **H¹** of this complex = sets of blocks that are **consistent in every pair but impossible all together** — a genuine higher-order contradiction that pairwise checking alone cannot find (the difference between _blind-men-and-the-elephant_, which is consistent, and a genuinely _frustrated_ set).

This is exposed as the `evaluate_logical_consistency` tool. The agent supplies blocks and their claims as first-order-logic propositions; the **engine** orchestrates all the satisfiability checks (so they can't be malformed) and returns H⁰/H¹, the offending `frustratedTriples`, and a full `checkLog` audit trail of every check run and its verdict.

It is verified end-to-end: the homology against a Python reference, the satisfiability against real Mace4, and the live pipeline against a calibrated corpus (`docs/logic-corpus/`) — a 3-wise-inconsistent set yields H¹=1 with the right frustrated triple, a pairwise contradiction yields a component split (H⁰) not a false H¹, and a fully-consistent set yields H¹=0 with the triple verified consistent. See `docs/emergent-bonds-and-stateless-reconstruction.md` §13–§15 for the full derivation and verification.

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

## Run logging & observability

Every run writes a complete, readable trace to `knowledge_base/runs/<timestamp>_<id>.jsonl` and a `.md` transcript alongside it: the **exact text fed into the graph each cycle**, the **full input and output of every tool call** (including the `checkLog` from `evaluate_logical_consistency`), and a run-end summary. The run-log id is also surfaced in tool output. This makes after-the-fact debugging a matter of reading one file rather than reconstructing from terminal scrollback.

## Optional MCP servers

AGEM does not require any MCP server other than `mcp-logic` (for contradiction detection). The meta-tools `list_mcp_servers`, `list_server_tools`, and `call_mcp_tool` let an agent reach any other server configured in `mcp.json` — useful utilities include `fetch`, `sqlite`, `memory`, `desktop-commander`, `playwright`, and `docker`. Other reasoning servers may be configured but are experimental and are not part of the standard workflow.

> [!NOTE]
> Earlier versions of AGEM were wired to an external "EFHF" suite of MCP servers (a second sheaf enforcer, an ethical-tier evaluator, a world-model, etc.). That coupling caused real confusion — notably _two independent sheaf systems_ claiming the same job — and was never actually wired into the engine (the bridge class was defined but never instantiated). AGEM is now self-contained: the engine computes its own H⁰, `mcp-logic` provides contradiction detection, and everything else is optional. If you are looking for the EFHF servers, they live in their own repositories. [Emergent Functional Hierarchies Framework](https://github.com/angrysky56/Emergent-Functional-Hierarchies-Framework)

## Key Features

- **Logic-based contradiction detection** — the consistency-complex H¹ pipeline (above), verified end-to-end against a real theorem prover.
- **Sheaf H⁰ connectivity** — `CellularSheaf` + `CohomologyAnalyzer` track how the concept graph fragments and coheres via SVD of the coboundary operator.
- **Text Network Analysis (TNA)** — co-occurrence graph, Louvain community detection, centrality, structural gap detection, ForceAtlas2 layout, catalyst-question generation.
- **Self-Organized Criticality (SOC)** — CDP, VNE, EE, SER tracking with phase-transition detection, regime classification, and System-1 ("conclusion precedes logic") detection via `RegimeValidator`.
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
│   ├── lcm/                   #   Lifecycle Context Model
│   ├── lumpability/           #   Lumpability auditing
│   └── types/                 #   Shared type definitions + events
├── interface/                 # Full-stack chat interface
│   ├── backend/src/services/  #   LLM providers, agem-bridge, logicalCohomology, run-logger, MCP manager
│   ├── frontend/              #   React + Vite dashboard
│   └── shared/                #   FE ↔ BE type contract
├── cli/                       # Interactive terminal REPL (thin HTTP client)
├── skills/                    # YAML-frontmatter agent skill definitions
├── docs/
│   ├── emergent-bonds-and-stateless-reconstruction.md  # Logic-H¹ derivation + verification (§13–15)
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

## License

MIT (or check `LICENSE` file if present)
