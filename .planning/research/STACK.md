# Stack Research

**Domain:** Multi-agent AI framework — LCM / Sheaf-theoretic coordination / Molecular-CoT / Text Network Analysis (TypeScript reference implementation)
**Researched:** 2026-02-27
**Confidence:** HIGH (versions verified against npm registry; rationale grounded in architectural requirements)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript | 5.9.3 | Primary implementation language | Strict types enforce mathematical invariants (stalk spaces, restriction maps, bond topology). Structural typing allows modelling heterogeneous agent state spaces without runtime overhead. Narrowing catches state-machine violations at compile time. |
| Node.js | 22 LTS | Runtime | Active LTS as of Oct 2025. Native `--experimental-vm-modules` for isolated agent sandboxes. Built-in `worker_threads` for parallel llm_map primitives. `AsyncLocalStorage` for deterministic LCM context propagation across async call trees. |
| `@langchain/langgraph` | 1.2.0 | Multi-agent orchestration, stateful graph execution | The only JS framework with first-class support for the two patterns this project needs: **Supervisor** (coordinator-worker for Sheaf Laplacian consensus rounds) and **Network** (peer-to-peer for Van der Waals exploratory agents). StateGraph + `Annotation.Root` maps directly to per-agent stalk spaces. `Command` with `goto` implements Sheaf-driven routing without a central controller. Persistent checkpointing satisfies LCM's Immutable Store requirement out of the box. |
| `@langchain/core` | 1.1.29 | Provider-agnostic LLM interface, message schema | Decouples agent logic from specific LLM endpoints. `BaseChatModel`, `BaseMessage`, and `StructuredOutput` are the stable abstraction layer all five framework components depend on. Switching from OpenAI to Anthropic or local Ollama requires only a provider swap, not architectural changes. |
| `graphology` | 0.26.0 | Core graph data structure for TNA semantic graph and Sheaf base space | Purpose-built for algorithmic graph work in JS/TS (unlike D3 or vis.js which are visualization-first). Typed multi-graph support represents weighted 4-gram co-occurrence edges with attributes. Serializable to JSON for LCM Immutable Store persistence. The entire graphology standard library (Louvain, betweenness, ForceAtlas2) is built against this exact API — no glue code. |
| `mathjs` | 15.1.1 | Linear algebra for Sheaf Laplacian, eigenvalue decomposition, Von Neumann entropy | Has `eigs()` for eigenvalue/eigenvector computation (Sheaf Laplacian spectrum), `multiply()` / `transpose()` / `det()` for coboundary operator assembly, and complex matrix support for cohomology calculations. The expression parser is useful for dynamic formula evaluation in Molecular-CoT bond-strength calculations. Pure JS — no native bindings to break. |

---

### Supporting Libraries

#### Multi-Agent / LLM Layer

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@langchain/openai` | 1.2.11 | GPT-4o and embedding models | Default reasoning engine for deep-reasoning (covalent) bonds and coordinator agents. `text-embedding-3-small` (1536-dim) drives TNA semantic similarity. |
| `@langchain/anthropic` | 1.3.21 | Claude models | Van der Waals exploratory agents benefit from Claude's longer effective context without prompt injection risk — useful for hypothesis-space expansion across distant semantic clusters. |
| `openai` | 6.25.0 | Direct OpenAI API access when LangChain overhead is undesirable | Streaming completions for real-time bond-strength monitoring. Use directly for high-frequency SOC entropy probes where LangChain's middleware adds measurable latency. |
| `@anthropic-ai/sdk` | 0.78.0 | Direct Anthropic API access | Same rationale as `openai` direct SDK — bypass chain overhead for latency-sensitive self-reflection (hydrogen bond) verification calls. |
| `langsmith` | 0.5.7 | Tracing and evaluation of agent runs | Attach to LangGraph runs to trace per-agent reasoning paths. Critical for validating that covalent bonds (72.56% cluster retention) and hydrogen bond reconnection rates (81.72%) match theoretical targets during development. |

#### Graph Algorithms (TNA / Sheaf Topology)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `graphology-communities-louvain` | 2.0.2 | Louvain modularity-based community detection | Core TNA component: identifies topical clusters in semantic co-occurrence graphs. The `detailed()` variant returns modularity score needed for structural gap threshold decisions. |
| `graphology-metrics` | 2.4.0 | Betweenness centrality, density, modularity | Provides `betweennessCentrality.assign()` for identifying conceptual bottleneck nodes. Also exposes `nodeBetweennessCentrality` for the structural gap scanner. |
| `graphology-layout-forceatlas2` | 0.10.1 | ForceAtlas2 spatial layout for semantic graph | Spatializes the TNA co-occurrence graph; hub-repulsion / peripheral-attraction dynamics match InfraNodus methodology. Layout positions are needed for structural gap distance calculations between Louvain communities. |
| `graphology-shortest-path` | 2.1.0 | Dijkstra / BFS shortest paths | Used in betweenness centrality computation and for measuring semantic distance between structural gap boundaries. |
| `graphology-traversal` | 0.3.1 | BFS/DFS graph traversal | Used in sheaf cohomology cycle detection (H1 obstruction scanning). Traverses the agent communication graph to find inconsistent feedback loops. |

#### NLP Preprocessing (TNA Pipeline)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `natural` | 8.1.0 | TF-IDF, stemming, tokenization, lemmatization | Implements the TF-IDF stopword filtering and lemmatization steps described in the InfraNodus pipeline. The `TfIdf` class handles weighted term extraction; `WordTokenizer` + `PorterStemmer` handles the 4-gram sliding window pre-processing. Established Node.js NLP library with no native dependencies. |
| `stopword` | 3.1.5 | Multi-language stopword removal | Supplements `natural` with a richer stopword corpus for auxiliary word stripping before 4-gram windowing. Supports 62 languages — important for cross-domain corpora ingested by exploratory agents. |
| `wink-lemmatizer` | 3.0.4 | Morphological lemmatization | More accurate lemmatization than Porter stemming for edge cases (irregular verbs, technical jargon). Use alongside `natural` when semantic precision matters more than speed. |
| `@huggingface/transformers` | 3.8.1 | Local ONNX-backed text embeddings (no API call) | Run `all-MiniLM-L6-v2` locally for embedding entropy computation (SOC metric) without burning API credits on high-frequency entropy probes. 384-dim vectors suffice for intra-session semantic distance calculations. |

#### Data Persistence (LCM Immutable Store + Active Context)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `better-sqlite3` | 12.6.2 | Synchronous SQLite for Immutable Store in reference impl | Synchronous API maps perfectly to the LCM requirement that `lcm_grep` searches return deterministically — no async surprises. Zero network latency; sufficient for reference implementation scale. Use PostgreSQL (`pg`) for production scale-out. |
| `pg` | 8.19.0 | PostgreSQL client for production Immutable Store | Swap in when multi-process agents need shared Immutable Store access. The document uses PostgreSQL explicitly as the reference RDBMS for the immutable ledger. |
| `drizzle-orm` | 0.45.1 | Type-safe SQL query builder | Generates typed SQL for LCM Immutable Store schema (session logs, summary nodes, tool traces). Drizzle's schema-as-code approach keeps the DAG summary node structure in TypeScript, not a separate migration language. |
| `ioredis` | 5.9.3 | Redis client for Active Context DAG cache | The LCM Active Context (hierarchical DAG of Summary Nodes) benefits from Redis as a fast key-value store for in-progress sessions. `lcm_expand` / `lcm_collapse` map to `GET` / `SET` with TTL. |
| `uuid` | 9.0.0 | Deterministic unique IDs for agent instances, summary nodes | Required for stable references in the Immutable Store ledger and for identifying sheaf stalk spaces per agent. |

#### Mathematics / Statistics (SOC Metrics)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ml-matrix` | 6.12.1 | Efficient dense matrix operations, SVD, LU decomposition | Use alongside `mathjs` when performance matters: `ml-matrix` uses typed arrays (Float64Array) while `mathjs` uses generic JS arrays. SVD is needed for embedding entropy (Von Neumann entropy of the embedding covariance matrix). |
| `simple-statistics` | 7.8.8 | Descriptive statistics, correlation, linear regression | Computes the structural-semantic correlation tracked for phase transition detection (~iteration 400). Also provides the running mean/variance needed for surprising-edge ratio maintenance (target: ~12%). |
| `ml-distance` | 4.0.1 | Cosine, Euclidean, Jaccard distance functions | Used in Van der Waals bond trajectory length computation (average 5.32 in t-SNE space) and for measuring semantic gap distances between Louvain community centroids. |

#### Validation / Schema

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | 3.24.2 | Runtime schema validation for agent state, tool inputs/outputs | LangGraph's `StructuredOutput` uses Zod natively. Define Zod schemas for sheaf stalk state spaces, LCM summary nodes, and Molecular-CoT bond descriptors so type errors surface as structured failures rather than silent hallucinations. |

---

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `vitest` 4.0.18 | Unit and integration testing | Native ESM support; no CommonJS shim needed for `@huggingface/transformers`. `--pool=forks` isolates heavy embedding tests. Each framework component (LCM primitives, Sheaf Laplacian, TNA pipeline, SOC metrics) gets its own `describe` suite with mathematical property checks. |
| `tsx` 4.21.0 | Zero-config TypeScript execution | Run individual component scripts without a build step during development. Faster feedback loop than `ts-node` for iterating on Sheaf Laplacian implementations. |
| `tsup` 8.5.1 | TypeScript bundle for library output | Produces clean CJS + ESM dual output if this becomes a publishable package. Tree-shakes unused graph algorithms. |
| `pino` 10.3.1 | Structured JSON logging | Structured logs are required for the LCM Immutable Store log ingestion pipeline — every agent action must be parseable by `lcm_grep`. Pino's child loggers map cleanly to per-agent log contexts. |
| `dotenv` 17.3.1 | Environment variable management | API keys (OpenAI, Anthropic), database URLs, Redis URLs. Use `dotenv/config` import in entry points only. |
| ESLint + `@typescript-eslint` | Linting | Enforce `no-any` and `strict-null-checks` — critical for sheaf restriction map implementations where type errors represent mathematical inconsistencies. |

---

## Installation

```bash
# Core framework
npm install @langchain/langgraph @langchain/core graphology mathjs

# LLM providers
npm install @langchain/openai @langchain/anthropic openai @anthropic-ai/sdk

# Graph algorithms
npm install graphology-communities-louvain graphology-metrics graphology-layout-forceatlas2 graphology-shortest-path graphology-traversal

# NLP / TNA pipeline
npm install natural stopword wink-lemmatizer @huggingface/transformers

# Data persistence
npm install better-sqlite3 drizzle-orm ioredis uuid

# Mathematics / SOC metrics
npm install ml-matrix simple-statistics ml-distance

# Validation
npm install zod

# Observability
npm install langsmith pino

# Dev dependencies
npm install -D typescript@5.9.3 vitest tsx tsup dotenv @types/node @types/better-sqlite3 @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@langchain/langgraph` | Mastra, CrewAI (JS port), AutoGen | If you need a no-code/low-code agent builder rather than a library. LangGraph is the only option with StateGraph semantics that maps to Sheaf stalk spaces without wrapping. |
| `graphology` | `d3-graph` / `cytoscape.js` | Use cytoscape.js if you need a UI rendering engine co-located with the graph. For pure algorithmic work graphology's standard library (Louvain, betweenness, ForceAtlas2) avoids reimplementing every algorithm from scratch. |
| `mathjs` | `numeric.js`, `stdlib` BLAS | `numeric.js` is abandoned (last release 2016). `@stdlib` is comprehensive but adds 50+ MB to install. `mathjs` covers all Sheaf Laplacian operations (eigenvalues, matrix multiply, complex numbers) in a well-maintained single package. |
| `ml-matrix` | `@tensorflow/tfjs-node`, `onnxruntime-node` | TF.js/ONNX for SVD only is massive overhead. `ml-matrix` is <200 KB and purpose-built for dense linear algebra in Node.js. Use TF.js only if you need GPU-accelerated training. |
| `better-sqlite3` | `pg` (PostgreSQL) | Use `pg` when the reference implementation is deployed multi-process or multi-machine. SQLite is simpler for local development and single-process validation of LCM primitives. |
| `@huggingface/transformers` | OpenAI `text-embedding-3-small` API | Use the API when embedding quality matters more than latency/cost. Use local ONNX when running high-frequency SOC entropy probes where API cost is prohibitive. |
| `natural` | `compromise`, `wink-nlp` | `compromise` is excellent for entity extraction and POS tagging but lacks TF-IDF. `wink-nlp` is faster but has less community documentation for custom pipelines. `natural` has native TF-IDF + stemming in one package matching the InfraNodus preprocessing spec. |
| `vitest` | `jest` | Jest requires CJS transforms for native ESM packages (`@huggingface/transformers`, LangChain). Vitest handles ESM natively with no configuration. |
| `pino` | `winston`, `bunyan` | Both are slower and produce less structured output. Pino's JSON serializer ensures LCM log entries are `lcm_grep`-compatible without post-processing. |
| `zod` | `io-ts`, `yup`, `valibot` | LangGraph uses Zod natively for structured outputs. Using a different schema library means writing adapters at the LangGraph boundary. Zod 3.x also has the most stable TypeScript inference story. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `langchain` (monolith v0.x) | The old monolithic `langchain` package has been split. Importing it causes bundle bloat and version conflicts with `@langchain/core`. | Import from `@langchain/core`, `@langchain/openai`, `@langchain/langgraph` directly. |
| `@tensorflow/tfjs-node` for matrix math | Requires native build tools (node-gyp, CUDA headers), breaks on Node.js version upgrades, and is 300+ MB for SVD/eigenvalue operations. | Use `mathjs` for eigenvalues and `ml-matrix` for SVD. Only use TF.js if GPU-accelerated neural network training is required. |
| `numeric.js` | Last commit: 2016. No TypeScript types. No eigenvalue support for complex matrices. Will not correctly handle the Sheaf Laplacian spectrum for complex eigenvalues. | `mathjs` 15.x with `eigs()` on complex matrices. |
| Python-based TDA libraries (Gudhi, Ripser) via subprocess | Adds a Python runtime dependency, subprocess latency, and serialization overhead to every cohomology computation. The reference implementation must be pure TypeScript. | Implement Sheaf Laplacian and H1 cohomology directly using `mathjs` and `graphology-traversal`. True persistent homology (Vietoris-Rips) is out of scope for this framework. |
| `d3` for graph algorithms | D3 is a visualization library, not a graph algorithm library. Its force simulation is not the ForceAtlas2 algorithm used by InfraNodus and produces different spatial semantics. | `graphology-layout-forceatlas2` for layout; `graphology-metrics` for centrality. |
| `axios` for LLM API calls | All LLM calls go through `@langchain/core` or the vendor SDKs. Adding a second HTTP client creates a maintenance surface and bypasses LangSmith tracing. | Use vendor SDKs (`openai`, `@anthropic-ai/sdk`) when bypassing LangChain; never raw HTTP. |
| `winston` / `bunyan` for logging | Neither produces NDJSON output that is trivially `grep`-able by regex, which is the `lcm_grep` interface requirement. Winston's multi-transport config adds complexity with no benefit here. | `pino` with `pino.child({ agentId })` for per-agent structured logs. |
| LangChain v0.1.x memory classes (`BufferMemory`, `ConversationSummaryMemory`) | These implement ad-hoc context summarization with no determinism guarantees — exactly the "context rot" problem LCM is designed to replace. | Implement LCM's Three-Level Escalation Protocol explicitly using LangGraph's checkpoint persistence + `better-sqlite3`. |

---

## Stack Patterns by Variant

**If validating LCM primitives in isolation (no LLM calls):**
- Use `better-sqlite3` + `zod` only
- Mock the LLM interface with deterministic stubs
- Test the DAG summary node expansion/collapse cycle with `vitest`
- Because LCM correctness is algorithmic, not model-dependent

**If implementing Sheaf Laplacian consensus (no TNA/LLM):**
- Use `graphology` + `mathjs` only
- Build the coboundary operator as a sparse matrix via `mathjs.sparse()`
- Verify convergence to global section via eigenvalue inspection (`math.eigs()`)
- Because Sheaf math is fully separable from language model behavior

**If implementing TNA / InfraNodus pipeline (standalone):**
- Use `graphology` + `graphology-communities-louvain` + `graphology-metrics` + `graphology-layout-forceatlas2` + `natural` + `stopword`
- Input: raw text corpus from agent reasoning traces
- Output: community partition + betweenness centrality map + structural gap coordinates
- Because TNA is a pure graph transformation pipeline; LLM only enters at the GraphRAG step

**If running SOC metrics against a live agent session:**
- Add `@huggingface/transformers` (embedding entropy) + `ml-matrix` (SVD for Von Neumann entropy) + `simple-statistics` (structural-semantic correlation)
- Keep SOC probes on a separate `setInterval` loop outside the critical reasoning path
- Because entropy probes are read-only observers; they must not block agent execution

**If deploying with multiple concurrent agent processes:**
- Replace `better-sqlite3` with `pg` + `ioredis`
- Because SQLite's write lock becomes a bottleneck with concurrent `llm_map` workers
- LangGraph's PostgreSQL checkpointer is a drop-in swap

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@langchain/langgraph@1.2.0` | `@langchain/core@1.1.29` | LangGraph and LangChain core must be within the same major version. Check peer dependency warnings on install. |
| `@langchain/langgraph@1.2.0` | `@langchain/openai@1.2.11`, `@langchain/anthropic@1.3.21` | Provider packages track `@langchain/core` minor versions. Mix-matching major versions causes `instanceof` failures on `BaseMessage`. |
| `graphology@0.26.0` | `graphology-communities-louvain@2.0.2`, `graphology-metrics@2.4.0`, `graphology-layout-forceatlas2@0.10.1` | All graphology standard library packages peer-depend on `graphology@^0.26`. Do not upgrade to a hypothetical `graphology@1.x` without checking all sub-packages. |
| `mathjs@15.1.1` | Node.js 18+ | Math.js 15.x dropped Node.js 16 support. Uses ESM by default; use `import` not `require`. |
| `@huggingface/transformers@3.8.1` | Node.js 18+, `onnxruntime-node` (auto-installed as peer dep) | Native ONNX bindings. Requires network access on first run to download model weights. Pre-download in CI using `pipeline(..., { localFilesOnly: false })` during setup step. |
| `better-sqlite3@12.6.2` | Node.js 18–22 | Requires node-gyp for native build. Ensure `python3` + `make` + `gcc` are available in CI. Pre-built binaries available for common platforms via `@mapbox/node-pre-gyp`. |
| `vitest@4.0.18` | TypeScript 5.x, Node.js 20+ | Vitest 4.x requires Node.js 20 minimum. Use `--pool=forks` when testing native modules (`better-sqlite3`, `onnxruntime-node`) to avoid shared-memory conflicts. |
| `drizzle-orm@0.45.1` | `better-sqlite3@12.x` OR `pg@8.x` | `drizzle-orm` supports both adapters; use `drizzle-orm/better-sqlite3` or `drizzle-orm/pg-core` import paths. Do not mix adapters in a single schema file. |

---

## Sources

- npm registry (live queries 2026-02-27) — All version numbers verified
- Context7 `/langchain-ai/langgraphjs` — LangGraph multi-agent patterns (Supervisor, Network, Command routing)
- Context7 `/graphology/graphology` — Louvain community detection, betweenness centrality, Leiden algorithm API
- Context7 `/josdejong/mathjs` — `eigs()` complex matrix support (v9.4.0+), matrix operations API
- Context7 `/huggingface/transformers.js` — Feature extraction pipeline, `all-MiniLM-L6-v2` embedding usage
- RLM-LCM-Molecular-CoT-Group-Evolving-Agents.md (project reference document) — Framework mathematical requirements verified against library capabilities

---

*Stack research for: RLM-LCM Molecular-CoT Group Evolving Agents Framework (TypeScript reference implementation)*
*Researched: 2026-02-27*
