---
name: "mcp-logic"
description: "Formal reasoning via FOL theorem proving, model finding, and categorical logic"
---

# MCP Logic Agent Guide

You are equipped with **mcp-logic**, a high-fidelity formal reasoning engine. It exposes the power of First-Order Logic (FOL) theorem proving, finite model finding, and categorical reasoning to your conversational interface.

---

## 🛠 Core Toolset

### 1. `prove` — Theorem Proving (Prover9)
**Purpose**: Rigorously prove that a conclusion follows from a set of premises.
- **When to use**: To verify the validity of logical arguments, confirm mathematical theorems, or check if specific implications hold.
- **Input Parameters**:
  - `premises` (Array of Strings): FOL formulas representing assumptions.
  - `conclusion` (String): The statement to be proven.
- **Best Practices**:
  - Keep predicates lowercase (e.g., `human(socrates)`).
  - Use explicit quantification: `all x (P(x) -> Q(x))`.
  - Parenthesize complex scopes: `all x (man(x) -> (exists y (father(y,x))))`.
  - When you encode "X's are Y" and mean it non-vacuously, also assert `exists x (X(x))`. Bare conditionals are vacuously true over an empty domain — see **🕳️ The Empty-World Trap**.

### 2. `find_model` — Consistency & Exploration (Mace4)
**Purpose**: Find a finite model (interpretation) where all premises are TRUE.
- **When to use**: To verify that a set of axioms is consistent, or to explore what kind of structures a theory permits.
- **Input Parameters**:
  - `premises` (Array of Strings): FOL axioms to satisfy.
  - `domain_size` (Integer, Optional): Fixed size of the domain. Omit to auto-scan sizes 2–10.
  - `verbose` (Boolean, Optional): Include the raw Mace4 interpretation — set `true` to inspect the model.
- **Pro Tip**: A returned model means the axioms are *satisfiable* — but **inspect the model before calling them "consistent."** If every predicate is empty or uniform (e.g. all `[0,0,0]`), the consistency is **vacuous**: the empty world satisfies almost anything. See **🕳️ The Empty-World Trap** below — this is the #1 way `find_model` misleads.

### 3. `find_counterexample` — Disproving Claims (Mace4)
**Purpose**: Show that a conclusion does NOT follow from premises by finding a "counter-model."
- **When to use**: When `prove` fails, use this to understand *why*. It finds a world where premises are true but the conclusion is false.
- **Input Parameters**:
  - `premises` (Array of Strings): Logical assumptions.
  - `conclusion` (String): The statement to disprove.
  - `domain_size` (Integer, Optional): Domain limit. Omit to auto-scan 2–10.
  - `verbose` (Boolean, Optional): Include the raw Mace4 counter-model.

### 4. `check_well_formed` — Syntax Guard
**Purpose**: Validate formula syntax and get detailed error/warning feedback.
- **When to use**: BEFORE calling `prove` or `find_model` for complex or user-provided formulas.
- **Validation Features**: Catches unmatched parentheses, invalid characters, and quantifier scope issues.

### 5. `check_contingency` — Propositional Fast-Path (HCC)
**Purpose**: Instantly check if a propositional formula is a tautology, contradiction, or contingent.
- **When to use**: For simple boolean logic (P, Q, R) where FOL power is overkill. Uses the Hypersequent Contingency Calculus.

### 6. `abductive_explain` — Inference to the Best Explanation (VFE)
**Purpose**: Select the "best" explanation for an observation from a list of candidates.
- **How it works**: Uses Variational Free Energy (VFE) scoring. It balances explanatory power (low surprisal) with syntactic simplicity (low complexity/Ockham's Razor).

---

## 📐 Categorical Reasoning Utilities

### 7. `get_category_axioms` — Structural Foundations
**Purpose**: Retrieve pre-defined FOL axioms for standard mathematical structures.
- **Supported Concepts**: `category`, `functor`, `natural-transformation`, `monoid`, `group`.

### 8. `verify_commutativity` — Diagram Verification
**Purpose**: Map path equality in a categorical diagram to a FOL proof problem.
- **Input**: `path_a`, `path_b` (Arrays of morphism names), `object_start`, `object_end`.
- **Note**: This tool generates the *setup*; you must pass the resulting premises/conclusion to `prove` to finalize the verification.

---

## 🕳️ The Empty-World Trap — Vacuous vs. Substantive Consistency

**Read this before reporting any "consistent" / "H¹ = 0" / "no contradiction" result.**

The most common way a formal check misleads: a universal conditional `all x (P(x) -> Q(x))` is **vacuously true when nothing is a `P`**. Mace4 will satisfy an entire theory with an empty or uniform world, and `find_model` will return a model in which every predicate is false. That model is "consistent" the way an empty room is "tidy" — it tells you almost nothing.

**Symptoms you are looking at vacuous consistency**
- `find_model` returns a model whose predicates are all-empty or uniform (e.g. every relation `[0,0,0]`).
- A set of blocks you *expected* to conflict comes back `consistent`, with no frustrated triples and H¹ = 0.
- `find_model` flips to `no_model_found` only after you add a strong extra axiom — meaning the earlier satisfying model was the empty one.

**The rule: assert existence for what your conditionals quantify over.** If the content means "X's exist and are Y," do not encode only `all x (X(x) -> Y(x))` — also add `exists x (X(x))`. "Consistent" should mean *co-satisfiable by a non-empty world*, not *vacuously dodged*.

**To test whether two blocks genuinely conflict** (instead of letting the empty world hide it):
1. Union their formulas.
2. Add the shared subject's existence, e.g. `exists x (organism(x))`.
3. Call `prove(premises, "$F")`. If ⊥ is **proved**, the conflict is real. If `unprovable`, call `find_model` and **inspect the model for non-triviality** (`verbose: true`).

**Worked example (real AGEM run — biosemiotics corpus).** Two blocks:
- **B1** (mechanist): `organism → machine → ¬sign_interpreting → ¬semiosis`  ⟹  `organism → ¬semiosis`
- **B3** (agent): `organism → autonomous_agent → self_interpreting → semiosis`  ⟹  `organism → semiosis`

The pairwise check returned **consistent** (H¹ = 0) — but only because no block asserted an organism exists; Mace4's satisfying model had `organism = [0,0,0]`. Adding `exists x (organism(x))` and re-running the *same* engine:
- `find_model` → **no_model_found**
- `prove(..., "$F")` → **proved** in 27 steps (the organism is forced to be both `semiosis` and `¬semiosis`).

The contradiction was real all along; the empty domain had hidden it. Reporting the first result as "the theory is consistent" would have been a false clean bill of health — and would have wrongly judged the corpus's central claim "logically under-determined" when it was the *encoding* that was under-committed.

> **This is the logic-layer form of self-consistency masquerading as world-consistency.** A consistency verdict reaches reality only as far as your encoding's *existence commitments* do. An empty or uniform model is the system reassuring itself about a world with nothing in it.

### Checklist — before you report "consistent"
- [ ] Did I assert that the key entities **exist** (`exists x ...`), or only conditionals *about* them?
- [ ] If `find_model` returned a model, is it **non-trivial** (predicates not all-empty/uniform)? Inspect with `verbose: true`.
- [ ] For any pair I *expected* to conflict, did I run `prove(..., "$F")` with existence asserted — not just `find_model` on the bare conditionals?
- [ ] Am I reporting "consistent" as *logically compatible*, not as *true*? (Consistency ≠ truth; vacuous consistency ≠ even that.)

---

## 🚀 Advanced Workflows

### The "Failure Recovery" Loop
1. **Try `prove(premises, conclusion)`**.
2. **If search fails**: Call `find_counterexample(premises, conclusion)`.
3. **If counterexample found**: Explain the specific model to the user (e.g., "In this world, Tweety is a bird but cannot fly...").
4. **If no counterexample found**: Increase `domain_size` (or omit it to auto-scan 2–10). If a model *was* found, inspect it for vacuity (see **🕳️ The Empty-World Trap**) before concluding the theory is consistent.

### Categorical Proofs
1. Call `get_category_axioms("category")`.
2. Add specific definition (e.g., `morphism(f)`, `compose(f, id, f)`).
3. Call `prove(...)` to verify properties like identity laws or associativity.

---

## ✍️ FOL Syntax Reference

| Name | Symbol | Example |
| :--- | :--- | :--- |
| **Universal** | `all` | `all x (human(x) -> mortal(x))` |
| **Existential** | `exists` | `exists x (prime(x) & even(x))` |
| **Negation** | `-` | `-cold(water)` |
| **Conjunction** | `&` | `P & Q` |
| **Disjunction** | `\|` | `P \| Q` |
| **Implication** | `->` | `P -> Q` |
| **Equivalence** | `<->` | `P <-> Q` |
| **Equality** | `=` | `x = y` |

---

## ⚠️ Important Constraints
- **Consistency ≠ Truth ≠ Non-vacuity**: Never report a set as "consistent" without running the **🕳️ Empty-World Trap** checklist — assert existence for what your conditionals quantify over, and inspect any returned model for non-triviality.
- **Studio-Ready Logic**: Always interpret Prover9/Mace4 outputs into plain English for the user. Don't just dump raw logic. Translate formal results into conversational explanations that convey the logical significance.
- **Complexity Management**: If a proof is taking too long, break it into **lemmas**. Prove the lemma first, then use it as a premise for the final goal.
- **Lowercase Convention**: Predicates and functions should be lowercase. Constants can be lowercase. Variables are usually `x`, `y`, `z`.