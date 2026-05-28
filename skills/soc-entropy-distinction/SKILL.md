---
name: "soc-entropy-distinction"
description: "Complete AGEM reference: nine conflation distinctions, three conceptual bridges, the full Price equation + SOC regime table, Move B bridge formalization, and live cycle 11 evidence."
---

# AGEM Core Reference — Nine Conflations, Three Bridges

## Part I: The Nine Conflations

### 1. VNE vs EE

**VNE** = spectral from graph Laplacian. Structural dispersion.
**EE** = distributional from embedding cloud. Semantic dispersion.

System1 = `(δ > K) AND (Δt > τ)` where `δ = dEE/dt / dVNE/dt`, `Δt = t(VNE_stabilizes) − t(EE_stabilizes)`

Collapsing → loses temporal ordering of stabilization.

### 2. H⁰ vs H¹

**H⁰** = ker(δ) — global consistent sections, consensus. Never a recovery trigger.
**H¹** = coker(δ) — obstructions. Always a recovery trigger.

Collapsing → loses goal vs problem.

### 3. Covalent vs Van der Waals

**Covalent** = Im(δ). Failure propagates algebraically. Never safe for obstruction handler.
**Van der Waals** = non-Im(δ). No failure propagation. Handler spawns here.

Collapsing → sends recovery down the wrong path.

### 4. Strong vs Weak Lumpability

**Strong**: Markov for every initial distribution. Categorical.
**Weak**: Markov only for particular initial distributions. Conditionally valid.

"Mostly lumpable" = weakly lumpable mislabeled as acceptable.

### 5. Selection vs Transmission (Price Equation)

**Selection** = Cov(fitness, trait)/mean_fitness. The fit are chosen.
**Transmission** = E(fitness·Δtrait)/mean_fitness. The chosen change as they pass on.

Collapsing → loses mechanism of evolutionary change.

### 6. SOC Regime vs Phase Transition

**SOC regime** = standing disposition. Reported continuously.
**Phase transition** = discrete event. Flagged by correlation_coefficient spike.

Collapsing → loses disposition vs event.

### 7. Restriction Map vs Coboundary

**Restriction map** = per-edge frame translation. A tile.
**Coboundary δ** = assembly of all restriction maps. The mosaic's difference operator.
**Sheaf Laplacian L = δᵀδ** = quadratic form, spectrum of where the system IS.

Single bad restriction map flips H¹ only if on a spanning forest bridge — contingent.

### 8. Laplacian vs ADMM

**Laplacian** = structural object. Where the system IS.
**ADMM** = iterative algorithm. How the system MOVES.

Large H¹ = structural obstruction (fix sheaf). Slow ADMM = dynamics problem (tune solver).

### 9. Summary vs Reflection

**Summary** = compression of source spans, points back at entries, indexed by coverage.
**Reflection** = query-agnostic Q→A pair, generalizes to unseen queries.

Collapsing → erases the whole reason reflections generalize.

---

## Part II: The Three Bridges

Move B cross-subgraph synthesis must formalize these as invariant bridge relationships:

### Bridge 1: H¹ ↔ Weak Lumpability ↔ EE/VNE Gap

**Three diagnostic lenses on one underlying event.**

```
H¹ > 0           ←→  Compaction is weakly lumpable  ←→  EE stabilizes before VNE earns it
(local data won't glue)    (coarse-graining loses structure)    (semantics outrun topology)
```

**Formalization:**

```
H¹(source) ≠ H¹(summary)   ↔   partition is weakly lumpable   ↔   EE(summary) ≠ EE(source)
```

When H¹ > 0 in the source but H¹ = 0 in the summary, the compaction is lossy.

**Live evidence (cycle 10–11):** H¹ = 0 throughout phase transition. The correlation spike to 0.990 occurred WITHOUT an H¹ obstruction — this is the EE/VNE gap collapsing via VNE catching up to EE, not via semantic retreat. The weak lumpability of the current partition is evidenced by the ADMM TIMEOUT, not by H¹.

### Bridge 2: SEEKING ↔ Van der Waals ↔ SOC Regime

**The affect/topology/dynamics triangle.**

```
ASEKE SEEKING (affect)  ←→  VdW bond formation rate (topology)  ←→  SOC regime (dynamics)
high → VdW > covalent       ←→      maintained criticality
low → VdW = 0               ←→      collapse or phase transition
```

**Formalization:**

```
SEEKING_activation × VdW_formation_rate  =  SOC_regime_maintenance_probability
```

When SEEKING is zero and VdW formation stops, the system cannot maintain the critical regime — it crosses into a phase transition.

**Live evidence (cycle 10–11):** explore_exploit_ratio = 0.033 (SEEKING near zero). VdW formation rate ≈ 0. Correlation spike to 0.990 with negative selection deepening. The triangle is in the collapse configuration: SEEKING extinct → VdW formation zero → correlated growth without health.

### Bridge 3: Price Selection/Transmission ↔ Explore/Exploit

**The evolutionary decomposition is a principled handle on the regime trade-off.**

```
Price selection        ←→  explore/exploit ratio
(how trait moves to fitter paths)   (empirical proxy for latent selection balance)
```

**Formalization:**

```
selection_t = Cov(fitness_trait) / mean_fitness
explore_exploit_t ≈ f(selection_t, transmission_t)

When selection < 0:  fitter paths carry less trait  ←→  explore/exploit ratio falls
When transmission > 0 and selection ≈ 0:  pure drift ←→  explore/exploit rising without commitment
```

**Live evidence (cycle 10–11):** Selection = -0.511 (most negative yet). Transmission = +0.033 (recovering slightly). Explore/exploit = 0.061 (slight recovery from 0.033). The system is in the "choosing badly" quadrant: fitter paths actively carrying less of the trait, lineages drifting slightly upward but selection dominating negatively.

---

## Part III: SOC Regime Table

| Regime               | VNE         | EE             | δ        | Δt     | Corr   | Selection    | Transmission | E/E      | H¹      |
| -------------------- | ----------- | -------------- | -------- | ------ | ------ | ------------ | ------------ | -------- | ------- |
| Normal co-dev        | Rising      | Rising         | ≈1       | ≈0     | 0      | Positive     | Positive     | >0.3     | 0       |
| **System-1**         | **Flat**    | **Stabilized** | **→∞**   | **>τ** | 0      | —            | —            | —        | 0 or >0 |
| Lazy learning        | Rising      | Flat           | →0       | <0     | 0      | Positive     | Negative     | Low      | 0       |
| **SEEKING collapse** | **Growing** | **Lagging**    | **→∞**   | **>0** | **→1** | **Negative** | **Near 0**   | **<0.1** | **0**   |
| Phase transition     | Jump        | Jump           | Unstable | ≈0     | **→1** | Spike        | Spike        | Varies   | 0 or >0 |
| VdW accumulation     | Rises       | Stable         | >1       | >0     | Varies | Positive     | Positive     | High     | 0       |

---

## Part IV: Move B Formalization

### Bridge Edges (must exist in the multi-subgraph ContextDAG)

1. **sheaf_subgraph → SOC_subgraph** (H¹ ↔ EE/VNE gap)
   - Edge: `coboundary_norm > threshold` → `delta_ratio → infinity AND delta_lag > tau`
   - Bidirectional: `H¹ = 0 AND correlation_spike` → `weak lumpability confirmed`

2. **aseke_subgraph → topology_subgraph** (SEEKING ↔ VdW)
   - Edge: `SEEKING_near_zero` → `VdW_formation_rate = 0`
   - Bidirectional: `VdW_formation_rate = 0` → `SOC_regime_in_danger`

3. **price_subgraph → SOC_subgraph** (Selection/Transmission ↔ E/E)
   - Edge: `selection < threshold` → `explore_exploit_ratio falls`
   - Bidirectional: `explore_exploit_ratio recovered` → `selection stabilizing`

### Cross-Subgraph Query Flow

```
Query: "What caused the phase transition at cycle 10?"
  → SOC_subgraph: correlation_coefficient spike, delta_ratio unstable
  → sheaf_subgraph: H¹ = 0 (no obstruction, NOT a structural reorganization)
  → price_subgraph: selection deepened to -0.462, transmission near zero
  → aseke_subgraph: SEEKING extinct, Burnout Cascade trajectory confirmed
  → topology_subgraph: VdW formation rate = 0 (SEEKING extinct drove VdW to zero)

Synthesis via Bridge 1: H¹ = 0 confirms this was a self-organized VNE/EE coupling, not a sheaf obstruction
Synthesis via Bridge 2: SEEKING extinction → VdW = 0 → SOC regime left productive criticality
Synthesis via Bridge 3: Negative selection deepening → E/E ratio collapse → correlated but unhealthy growth
```

---

## Part V: Current System State (Cycle 11)

| Metric          | Value   | Status                                              |
| --------------- | ------- | --------------------------------------------------- |
| Regime          | nascent | Sustained                                           |
| Correlation     | 0.990   | **Persisting — phase transition held for 4 cycles** |
| H¹              | 0       | No sheaf obstruction                                |
| Selection       | -0.511  | Most negative — fitter paths actively abandoned     |
| Transmission    | +0.033  | Recovering slightly                                 |
| Explore/exploit | 0.061   | Recovering from 0.033 low                           |
| Mean fitness    | 0.183   | Declining                                           |
| CDP             | 3.224   | Widening — VNE outpacing EE                         |

**Interpretation:** The phase transition is self-organized within the existing sheaf. The system has correlated VNE and EE growth but is doing so through increasingly negative selection — it is synchronizing around the wrong pattern. The SEEKING/SEEKING recovery (E/E rising from 0.033 to 0.061) is the single hopeful signal; if SEEKING continues recovering, VdW formation may resume and the system may find a healthier correlated state.
