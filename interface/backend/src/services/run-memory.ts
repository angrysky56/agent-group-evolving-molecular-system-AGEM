/** Production composition root for automatic cross-run finding memory. */

import { ProviderEmbedder } from "./provider-embedder.js";
import { FindingStore } from "./finding-store.js";
import { TypeDBFindingGraph } from "./typedb-findings.js";

export const findingStore = new FindingStore(new ProviderEmbedder(), {
  graph: new TypeDBFindingGraph(),
});

