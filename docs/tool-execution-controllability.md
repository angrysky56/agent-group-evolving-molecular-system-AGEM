# Tool Execution: Bounded Recovery, Context Partition, Output Contract

Status: implemented. 53 tests in `interface/backend/src/services/*.test.ts`.

This documents the controllability layer added to the chat tool loop, why each
piece exists, and — importantly — what was deliberately *not* adopted.

## Source and scope

The design vocabulary comes from *From Agent Loops to Structured Graphs: A
Scheduler-Theoretic Framework for LLM Agent Execution* (Hu Wei, arXiv:2604.11378v1,
Apr 2026).

**That paper is a position paper with no empirical validation.** It says so
itself: its predictions (`G_graph > 0`, gain increasing with task complexity,
`G_replan > 0` on failure-prone tasks) are stated as logical consequences of its
assumptions, untested, with the experimental protocol left as future work. None
of it is treated here as evidence.

**Its central prescription — the static DAG — was rejected for AGEM.** The paper
disqualifies its own architecture for exactly AGEM's domain (§9.7, §10.2):
open-ended exploration ("research this topic and write a survey"), dynamic goal
evolution, and creative generation are named as task classes where static
commitment is a *liability*, and are punted to a companion "Evolutionary Graph
Architecture" — which is roughly what AGEM already is. Committing AGEM to a
pre-planned DAG would trade away the thing it exists to do.

What did transfer is the paper's controllability layer, which is orthogonal to
static DAGs and which AGEM had none of.

## Where AGEM sat before

On the paper's scheduler continuum (§3.4), the chat loop was a **Structured
Loop**: ready-set cardinality `|U| = 1`, non-deterministic scheduling policy,
prompt-level scaffold (the numbered Workflow block in the system prompt). One
step below the top of the single-ready-unit regime.

Four specific gaps:

| Gap | Symptom |
| --- | --- |
| No bounded recovery | Every failure became `"Error executing tool: " + err.message`, handed to the LLM, which decided ad hoc with no bound. The only retry rule was prose in the system prompt ("retry ONCE") — unenforceable by construction. |
| No context partition | Raw error strings entered `historyMessages`, flowed through `compress()` into every later turn, and could be re-pasted into `run_agem_cycle` and thus into the concept graph. |
| Serial dispatch | `for (const tc of result.tool_calls)` awaited each call in turn, even for independent reads of the same immutable post-cycle state. |
| Turn-count completion proxy | `MIN_TURNS_BEFORE_DONE = 4` nudged on turn count, which is unrelated to whether the workflow ran. |

## What was built

### 1. `recovery-protocol.ts` — bounded three-level recovery

```
L1 local_retry  transient faults (network, timeout, rate limit, 5xx)
                → engine-side retry with exponential backoff, no LLM turn spent
L2 local_patch  schema faults
                → deterministic argument repair, then one re-run
L3 escalate     → terse structured notice to the model
```

The escalation invariant (§6.2) is enforced mechanically, not by convention:
a per-`(tool, args)` counter `pristine → retried → patched` gates the levels.
`attemptPatch` throws unless state ≥ `retried`; `escalate` throws unless state ≥
`patched`. Unpatchable failures mark lower levels vacuously exhausted **with a
recorded reason**, so the audit trail shows why a level was skipped rather than
leaving a hole.

Level 2 reuses `normalizeMcpToolArgs`, which already existed in `chat.ts` but ran
only *pre-emptively*. It is now also wired as failure-triggered repair, which is
what makes the system prompt's "retry ONCE" rule real.

Three deliberate deviations from the paper:

- **Auth failures are structural, not L2-patchable.** A 401 will never succeed on
  retry and nothing in the loop can repair a credential. Burning the budget on it
  only adds latency before the inevitable escalation.
- **Non-idempotent calls are never blind-retried** (`retryBudget: 0`).
  `run_agem_cycle` ingests into a persistent, accumulating graph; a silent retry
  after a transient fault would pile the same co-occurrences on twice and degrade
  modularity — the exact failure the system prompt warns the model about. The
  engine cannot know whether the effect landed before the transport failed, so
  the decision goes to the model with a notice that says so. This is the paper's
  §9.10 idempotency point applied where it actually bites.
- **AGEM's existing L3 is stronger than the paper's.** The LCM
  `EscalationProtocol`'s level 3 (`deterministicChunkCompress`) is provably
  terminating with zero inference. The paper's L3 is `request_replan`, still
  LLM-dependent. The new module is named `RecoveryProtocol` to keep the two
  distinct — they are different domains (tool failure vs context compression)
  that happen to share the ladder shape.

### 2. Context partition (§5.4)

`C_exec ∩ C_diag = ∅`. The run log **is** the diagnostic context.

- `RecoveryOutcome.output` — the only thing permitted into chat history. Terse,
  single-line, length-capped, and structured: what failed, how hard the engine
  already tried, what the model may do next, and a run-log id.
- `RecoveryOutcome.detail` + `onDiagnostic` — full stack, response body, every
  attempt, the patched arguments. Goes to `runLog.event("recovery", …)` only.

The notice budgets its φ (observed-failure) field dynamically so that a
multi-kilobyte upstream error cannot crowd out the guidance and the run-log
pointer. Truncating the notice as a whole would drop exactly the parts the model
needs.

This is the same disease as the TNA garbage-token problem, one layer up: junk
was reaching the graph, this time via failure text in history rather than via
tokenization.

### 3. `tool-dispatch.ts` — side-effect-aware parallel dispatch (§4.5)

Consecutive read-only calls run concurrently; every mutating call is a wave of
its own. Relative read/write order is preserved, so `run_agem_cycle` followed by
`get_cohomology` still reads post-cycle state. Results are returned in original
call order regardless of completion order, so history stays deterministic.

Unknown tools default to **mutating**. Misclassifying a read as a write costs
latency; the reverse corrupts the graph. Only a short verified allowlist of pure
MCP targets (`mcp-logic/prove`, `find_counterexample`, `check_well_formed` —
pure functions of their input formulas) is treated as parallel-safe.

Concurrency is bounded (`TOOL_MAX_CONCURRENCY`, default 4) so a model emitting
twenty reads cannot open twenty concurrent Prover9 processes.

### 4. `workflow-contract.ts` — output contract κ (§6.1)

Replaces the turn-count proxy with a checkable one:

1. at least one `run_agem_cycle` (ingest)
2. at least one `get_graph_topology` (inspect)
3. if the corpus is multi-position: at least one logical-consistency check

"Multi-position" is read from AGEM's own clustering — two or more concept
communities after a cycle — rather than by keyword-matching the user's prose.
That keeps the trigger deterministic and grounded in a signal the system already
computes.

Only **successful** calls count. A contract satisfied by a tool that errored is
not satisfied.

Bounded two ways so it cannot become the pathology it removes: `maxNudges` total
(default 2), and the same unmet set is never raised twice — if the model was told
what was missing and did not act, repeating it is a loop, not recovery.

Both cases the old heuristic got backwards are now covered by tests: a run that
completes the workflow in three turns is no longer nudged; a run that burns six
turns without ingesting anything no longer passes.

### 5. MCP path consistency fix

`normalizeMcpToolArgs` ran on the `call_mcp_tool` meta path but not on the direct
`mcp__server__tool` path, which passed raw args straight through. Same tools,
two different arg-handling behaviours. Both paths are now identical.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `TOOL_RETRY_BUDGET` | 2 | L1 retries for transient faults on idempotent calls |
| `TOOL_MAX_CONCURRENCY` | 4 | Max simultaneous read-only tool calls |
| `CHAT_ENFORCE_WORKFLOW_CONTRACT` | true | Enforce κ before a run may finish |

## Known limitations

- A few tool branches (`create_skill`, `generate_scenario`, `list_server_tools`)
  still catch internally and return a curated error string, which the protocol
  reads as success. These are short, deliberate domain messages rather than
  stack traces, so they do not violate the context partition in practice — but
  they do bypass the ladder. Worth revisiting if any of them starts failing
  transiently.
- Parallel dispatch only pays off when models actually batch tool calls. Check
  `knowledge_base/runs/*.jsonl` for multi-call turns before assuming a win.
- `Orchestrator.runReasoning` is still a linear 8-step chain — the paper's §9.8
  "degenerate single-ready-unit scheduler". **Measured and closed: do not
  parallelise steps 6 and 7.** See below.

## Measured: should sheaf and SOC run in parallel? No.

`src/orchestrator/phase-timing.bench.ts` times each phase of a cycle
(`npx tsx src/orchestrator/phase-timing.bench.ts`). Per cycle, on this machine:

| nodes | edges | preprocess | graph | louvain | sheaf (step 6) | SOC (step 7) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 121 | 1128 | 1.3 | 6.0 | 1.0 | **0.4** | **327** |
| 201 | 2440 | 3.7 | 9.2 | 0.8 | **0.2** | **1 690** |
| 382 | 5374 | 7.2 | 19.3 | 1.7 | **0.3** | **14 498** |

(ms.) Parallelising steps 6 and 7 saves at most `min(sheaf, soc)` — i.e. **0.3
ms**, against an LLM turn of 2 000–20 000 ms. Not worth one line of concurrency
risk in event handlers that mutate orchestrator state. The question is settled;
the benchmark is kept so it can be re-settled if the phases change.

### What the measurement actually found

SOC is the entire non-LLM cost of a cycle, and it scales as roughly **n^3.3** in
node count:

| nodes | SOC per cycle |
| ---: | ---: |
| 200 | 1.7 s |
| 382 | 14.5 s (measured) |
| 600 | 64 s |
| 800 | 2.8 min |
| 1200 | 10.6 min |
| 2000 | 57 min |

Cause: `src/soc/entropy.ts` computes von Neumann entropy via a **dense**
eigendecomposition of the full n×n normalised Laplacian (`math.eigs`, pure-JS,
no LAPACK), plus a second `EigenvalueDecomposition` for the embedding-entropy
covariance. There is no node cap and no guard.

This matters because AGEM's graph is *persistent and accumulates across every
cycle of a session* — the cost is not per-corpus, it is per-cycle and rising.
A few cycles of real material and every subsequent cycle stalls.

### Fixed: FINGER linear-time VNE

Implemented in `src/soc/fingerEntropy.ts`, from Chen et al., *Fast Incremental
von Neumann Graph Entropy Computation* (ICML 2019). Same benchmark after:

| nodes | SOC before | SOC after |
| ---: | ---: | ---: |
| 121 | 330 ms | 330 ms (exact, below threshold) |
| 201 | 1 696 ms | 1 696 ms (exact, below threshold) |
| 382 | 14 498 ms | **19.8 ms** |
| 682 | ~64 s | **15.0 ms** |
| 1282 | ~11 min | **54.1 ms** |
| 2082 | ~57 min | **84.3 ms** |

**This is a re-derivation, not a transcription.** FINGER publishes its closed
form for the *combinatorial* Laplacian scaled by its trace; AGEM's entropy.ts
uses the *symmetric normalized* Laplacian `I − D^(−1/2) A D^(−1/2)`. Using the
published formula directly would have silently computed a different quantity.
What generalises is the identity `Q = 1 − tr(ρ²)`; only the closed form for
`tr(ρ²)` is matrix-specific. For AGEM's ρ:

```
Q = 1 − [ n + 2·Σ_(i,j)∈E wᵢⱼ²/(dᵢdⱼ) ] / n²        Ĥ = −Q · ln λ_max
```

with λ_max from power iteration. Both O(n+m). The derivation is checked against
Kₙ, where it gives `Q = (n−2)/(n−1)` and `λ_max(ρ) = 1/(n−1)` — both asserted in
`fingerEntropy.test.ts` against the real exact solver, not hand-copied numbers.

Properties that made this safe to adopt:

- **Lower bound on exact** (FINGER Thm 1) — the metric errs conservative, never
  over-claiming structure. Asserted across graph families.
- **Error shrinks as the graph grows** — relative error `1/(n−1)` on Kₙ, i.e.
  the approximation is most accurate exactly where it is needed. Asserted.
- **Deterministic** — fixed power-iteration start vector, never `Math.random`,
  matching the seeded-Louvain precedent. Bit-identical across runs.
- **Ordering preserved** — SOC reads VNE as a trend, so monotonicity matters
  more than absolute value. Asserted.

Threshold: `SOCConfig.exactEntropyMaxNodes` (default 250). Below it the exact
solver is cheap enough to be worth the fidelity; above it, FINGER. Set to `0`
to always approximate.

**The estimator switch is measured, not hidden.** Because FINGER is a lower
bound, crossing the threshold steps the VNE series down — and VNE feeds a
rolling correlation and a regime classifier that read *trends*, so an
unexplained step could register as a phantom phase transition. On the single
iteration where the switch happens, SOCTracker computes the exact value too and
logs the offset (`getApproximationOffset()`). One-off cost, and the
discontinuity becomes a number rather than a surprise.

Remaining knob: on near-regular graphs (clustered spectrum) plain power
iteration plateaus at a residual noise floor around 1e-4 instead of converging;
entropy is still accurate to ~1e-4 nats, and `relativeResidual` reports the
bound honestly. Real word-co-occurrence graphs are hub-heavy and converge
cleanly (measured 2.3e-8). A Lanczos solver would fix the pathological case if
it ever matters.

FINGER also gives an **incremental** update rule (Thm 2) for `Q` under edge
additions, which suits AGEM's accumulating graph. Not implemented: `Q` is
already O(n+m) to recompute, which is microseconds at these sizes.
