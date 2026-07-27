import { Preprocessor } from "../src/tna/Preprocessor.js";
const p = new Preprocessor({ minTfidfWeight: 0.0 });
const probes = [
  "It is not different without its own others accompany",
  "They were being does has such very much more than",
  "Phenomenal consciousness is not access consciousness and they can come apart",
];
for (const probe of probes) {
  console.log("IN :", probe);
  console.log("OUT:", p.preprocessDetailed(probe).tokens.join(" ") || "(empty)");
  console.log();
}
