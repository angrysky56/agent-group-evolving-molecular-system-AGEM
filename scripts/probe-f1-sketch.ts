/** Probe of the F1/TTT sketch: feed it IDENTICAL segments and see if it scores them equally. */
interface SegmentContext { F1_Si: number; HD_Vector: number[] }

function Encode_HD(_tj: string): number[] {
  return Array.from({ length: 8 }, () => Math.random());
}
function TTT(P_tj: Set<number>, P_tl: Set<number>): number {
  if (P_tj.size === 0 || P_tl.size === 0) return 0.0;
  let min_dist = Infinity;
  for (const l of P_tl) for (const j of P_tj) {
    const dist = Math.abs(l - j);
    if (dist < min_dist) min_dist = dist;
  }
  return min_dist > 0 ? 1.0 / min_dist : 0.0;
}

function evaluateContextualUnderstanding(
  document: string[][], otherSegments: string[][],
): Record<string, SegmentContext> {
  let N = 0;
  let HD_Vector: number[] = [];
  const segmentScores: Record<string, SegmentContext> = {};
  document.forEach((Si, i) => {
    let PTF = 0;
    Si.forEach((tj, j) => {
      let f_tj = 0;
      const P_tj = new Set<number>();
      otherSegments.forEach((segment) => {
        segment.forEach((tk, k) => {
          if (tj === tk) { f_tj += 1; P_tj.add(k); N += 1; }
        });
      });
      HD_Vector = Encode_HD(tj);
      let Total_TP = 0;
      Si.forEach((tl, l) => {
        if (l !== j) {
          const P_tl = new Set<number>();
          Si.forEach((term, idx) => { if (term === tl) P_tl.add(idx); });
          Total_TP += TTT(P_tj, P_tl);
        }
      });
      PTF += Total_TP + f_tj;
    });
    const F1_Si = N > 0 ? PTF / N : 0;
    segmentScores[`S${i}`] = { F1_Si, HD_Vector: [...HD_Vector] };
  });
  return segmentScores;
}

// Five byte-identical segments. Any content-based score must give all five the same value.
const seg = ["consciousness", "is", "not", "access", "consciousness"];
const doc = [ [...seg], [...seg], [...seg], [...seg], [...seg] ];
const others = [["consciousness", "access"], ["phi", "broadcast", "consciousness"]];

const out = evaluateContextualUnderstanding(doc, others);
console.log("Five IDENTICAL segments:");
for (const [k, v] of Object.entries(out)) console.log(`  ${k}: F1 = ${v.F1_Si.toFixed(5)}`);

const vecs = Object.values(out).map((v) => JSON.stringify(v.HD_Vector.slice(0, 2)));
console.log("\nHD_Vector for each (identical segments):");
vecs.forEach((v, i) => console.log(`  S${i}: ${v}`));
