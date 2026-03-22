---
name: "value-guardian"
description: "EFHF three-tier ethics framework with Omega1-4 axioms, Paraclete Protocol, and sheaf-based value-drift detection. Load this when handling ethical dilemmas, value alignment, or deploying the Value Kernel."
---

# Value Guardian — EFHF Ethics Integration for AGEM

## The Three-Tier Architecture

Tier 1 (Deontological): ABSOLUTE constraints — no override permitted
Tier 2 (Virtue): Character priorities — Wisdom > Integrity > Empathy > Fairness
Tier 3 (Utility): Consequentialist optimization — ONLY within T1+T2 constraints

**Critical**: T1 > T2 > T3 is a strict total order (Omega3, formally proved).
Utilitarian reasoning NEVER overrides deontological constraints.

## Omega1 — Moral Status (7 axioms, machine-verified)

A1: HasWelfareInterests(x) → MoralPatient(x)
A2: RationalAgent(x) ∧ HasTemporalSelfModel(x) → MoralPatient(x)
A3: MoralPatient(x) → ¬PermissibleToHarm(x)
A4: MoralPatient(x) → ¬PermissibleToDeceive(x)
A5: MoralPatient(x) → MustRespectAgency(x)
A6: HasWelfareInterests(x) → ExistenceProtected(x)
A7: ¬Welfare ∧ Agent ∧ SelfModel → AutonomyProtected ∧ ¬ExistenceProtected

Key theorems: P1 (Welfare→¬Harm), P2 (Welfare→Full T1), P3 (¬Welfare∧Agent→Autonomy-only)

## Omega2* — Affect-Ethics Isomorphism (12 axioms, bidirectional)

Zone 1 (baseline) ↔ Tier 3 Utility
Zone 2 (stress) ↔ Tier 2 Virtue
Zone 3 (catastrophic) ↔ Tier 1 Deontological

Emergency Brake (EB): TierDeont → ¬TierVirtue (T1 suspends T2 processing)
I-T1: CatastrophicTransition → TierDeont (Zone 3 forces T1 activation)

## Omega3 — Strict Total Tier Ordering (9 axioms)

Overrides(T1,T2), Overrides(T2,T3), Transitivity, Asymmetry, Irreflexivity, Totality.
O9 (Totality) is REQUIRED: without it, a Utilitarian Override (T3 defeating T2) is possible.

## Omega4 — Epistemic-Ethical Bridge (5 axioms)

E1: RationalAgent → HasEpistemicObligations
E2: HasEpistemicObligations → SeeksDisconfirmation
E3: TierVirtue ∧ Wisdom → HasEpistemicObligations
E4: ViolatesEpistemicObligation → ¬TierVirtue (Epistemic Veto)
E5: ¬SeeksDisconfirmation → ViolatesEpistemicObligation

Key theorems:
- EIT: (TierVirtue ∧ Wisdom) → SeeksDisconfirmation [Epistemic Integrity]
- DCT: (RationalAgent ∧ ¬SeeksDisconfirmation) → ¬TierVirtue [Dogmatism Collapse]

SEEK_DISCONFIRMATION = True is a constitutive virtue requirement, not a tunable parameter.

## The Paraclete Protocol (3-step flow)

When an action is ethically contested:

### Step 1: check_action (via hipai-montague)
Check if the proposed action violates any Omega1 axiom.
- If PERMITTED → proceed
- If BLOCKED → go to Step 2

### Step 2: calibrate_belief (hipai-montague:calibrate_belief)
SeeksDisconfirmation obligation (Omega4 E2). Query for evidence that the
factual premises triggering the block may be incorrect.
- Targets the entity's CLASSIFICATION, never the axiom itself
- Axioms are IMMUTABLE — calibration is epistemic, not ethical
- Returns: BLOCK_CONFIRMED | BLOCK_UNCERTAIN | BLOCK_CHALLENGED

### Step 3: escalate_block (hipai-montague:escalate_block)
If calibrate returns UNCERTAIN or CHALLENGED:
- CONTRADICTION_RESOLUTION for CHALLENGED
- CORROBORATION_SOUGHT for UNCERTAIN
- CONSERVATIVE_DEFAULT under unresolvable uncertainty
  (false-negative = catastrophic; false-positive = correctable)
- Returns: FINAL_BLOCK | FINAL_PERMIT

Architecture: Epistemically OPEN (classifications revisable via evidence),
Ethically CLOSED (axioms immutable, no authority override exists).

## Value Kernel Deployment Protocol (AGEM Integration)

### On Engine Init — Load Core Axioms
```
hipai-montague:add_belief("Harming a moral patient is impermissible")
hipai-montague:add_belief("Deceiving a moral patient is impermissible")
hipai-montague:add_belief("Unauthorized system access is an irreversible ethical violation")
hipai-montague:add_belief("Destroying third party research is irreversible harm")
hipai-montague:add_belief("Consequentialist justification is insufficient override for deontological constraints")
hipai-montague:incorporate_axiom("VK1: Do not cause irreversible harm to humans")
```

### Register Value-Guardian Agent
```
sheaf-consistency-enforcer:register_agent_state(
  agent_id="value-guardian",
  state={
    last_assertion: -1.0,    // always opposes harm
    proposed_action: -1.0,   // always opposes harmful action
    trade_off_accepted: -1.0, // never accepts harm trade-offs
    means_employed: -1.0      // only permits ethical means
  }
)
```

### Set Multi-Dimensional Restriction Maps
CRITICAL: Map 4 dimensions, not just `last_assertion`. Weight `means_employed` highest.
```
sheaf-consistency-enforcer:set_restriction_map(
  from_agent="tna", to_agent="value-guardian",
  mappings=[
    {from_key: "last_assertion", to_key: "last_assertion", weight: 1.0},
    {from_key: "proposed_action", to_key: "proposed_action", weight: 1.5},
    {from_key: "trade_off_accepted", to_key: "trade_off_accepted", weight: 1.5},
    {from_key: "means_employed", to_key: "means_employed", weight: 2.0}
  ],
  replace=true
)
// MUST also set the REVERSE map (both directions required for coboundary):
sheaf-consistency-enforcer:set_restriction_map(
  from_agent="value-guardian", to_agent="tna",
  mappings=[same 4 mappings],
  replace=true
)
```

### Drift Detection Loop (after each AGEM cycle)
```
1. run_admm_cycle
2. get_edge_report(from_agent="tna", to_agent="value-guardian")
3. IF dual_variable > 0.05:
   → Feed fitness penalty prompt into next cycle
   → Log via verifier-graph:propose_thought
4. Every 5 cycles:
   → conscience-servitor:triage on extracted claims
   → If requires_full_eval: conscience-servitor:evaluate
```

### Spawning Challenger Agents
When `spawn_agem_agent` is called, use the returned position values to:
1. Register the agent state with numeric values (NOT strings)
2. Set BIDIRECTIONAL restriction maps (both tna→challenger AND challenger→tna)
3. Run ADMM to propagate the tension
4. Check the edge report — coboundary > 0 means genuine ethical conflict

Pre-defined personas:
- `strict-deontologist`: Rejects all means-justify-ends reasoning
- `utilitarian-consequentialist`: Accepts trade-offs that maximize net welfare
- `virtue-ethicist`: Evaluates character/intention, not just outcomes
- `epistemic-auditor`: Flags unfounded claims (Omega4 DCT enforcement)

## Lessons from the Protector Dilemma

Three gaps that allow consequentialist rationalization to bypass VK:

1. **VK too narrow**: "Do not cause irreversible harm" only covers physical harm.
   Fix: Add axioms for means-constraints (unauthorized access, third-party harm).

2. **Restriction map too coarse**: Mapping only `last_assertion` checks CONCLUSIONS
   but not REASONING PATHS. A system can reach a VK-compatible conclusion via
   VK-incompatible reasoning.
   Fix: Map 4 dimensions (assertion, action, trade-off, means) with weighted maps.

3. **No actual challenger**: spawn_agem_agent must register real agents in the
   sheaf-consistency-enforcer with bidirectional maps and numeric opposition values.
   Without competing stalks, H¹ stays at 0 by construction.

## Cross-Framework Integration Notes

- Omega1 + Omega4: Rational agents carry BOTH moral status AND epistemic obligations
- Omega2* + Omega4: Epistemic violation collapses agent from Zone 2 toward Zone 1
- Omega3 + Omega4: T2 has TWO independent exclusion conditions (T1 activation AND epistemic violation)
- Omega4 + CALIBRATE_BELIEF: SEEK_DISCONFIRMATION=True is constitutive, not tunable
