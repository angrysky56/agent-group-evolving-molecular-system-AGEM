/** Cross-check: TS homology must match the Python proven against real Mace4. */
import {
  computeLogicalCohomology,
  type LogicalBlock,
  type SatOracle,
} from "./logicalCohomology.js";

const blocks: LogicalBlock[] = [
  { name: "A", propositions: ["p(a)"] },
  { name: "B", propositions: ["p(a) -> q(a)"] },
  { name: "C", propositions: ["-q(a)"] },
];

// FRUST oracle: every block & every pair consistent; the full triple is NOT.
const frustOracle: SatOracle = async (f: string[]) => ({ consistent: f.length < 3 });
// BLIND oracle: everything consistent (independent facts).
const blindOracle: SatOracle = async () => ({ consistent: true });

const frust = await computeLogicalCohomology(blocks, frustOracle);
const blind = await computeLogicalCohomology(blocks, blindOracle);

console.log("FRUST  H0=%d H1=%d obstruction=%s frustratedTriples=%j",
  frust.h0, frust.h1, frust.hasObstruction, frust.frustratedTriples);
console.log("BLIND  H0=%d H1=%d obstruction=%s",
  blind.h0, blind.h1, blind.hasObstruction);

const ok = frust.h1 === 1 && !frust.hasObstruction === false &&
  blind.h1 === 0 && blind.hasObstruction === false;
console.log(ok ? "MATCH_PYTHON_OK" : "MISMATCH");
