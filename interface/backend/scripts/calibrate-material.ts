import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { measureMaterial, classifyFromSignals } from "../src/services/material-assessment.js";
const ROOT = "../../";
function walk(d: string): string[] {
  try {
    return readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(md|txt)$/.test(p) ? [p] : [];
    });
  } catch { return []; }
}
const files = [...walk(ROOT + "corpora"), ...walk(ROOT + "docs/logic-corpus")];
console.log("prop  attr   fig   chars  class            file");
for (const f of files) {
  const s = measureMaterial(readFileSync(f, "utf8"));
  if (s.chars < 600) continue;
  const c = classifyFromSignals(s);
  console.log(
    s.propositionalCueDensity.toFixed(3),
    s.attributionCueDensity.toFixed(3),
    s.figurativeCueDensity.toFixed(3),
    String(s.chars).padStart(6),
    c.formalizability.padEnd(16),
    f.replace(ROOT, "").slice(0, 46),
  );
}
