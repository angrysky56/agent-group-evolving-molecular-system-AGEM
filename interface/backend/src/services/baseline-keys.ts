/**
 * baseline-keys.ts — load the answer keys that live beside the corpora.
 *
 * This file used to CONTAIN the keys, hand-transcribed by me from the prose in
 * `answer-key.md`. That put the transcriber between the arbiter and the engine,
 * and the transcription was wrong in exactly the way you would predict: I
 * copied `measurement_independence` into the Brukner conjuncts because the
 * prose key says so, when the corpus at line 148 says `free choice`. I had
 * enshrined a paraphrase as the ground truth the engine would be scored against.
 *
 * So the keys now live at `corpora/<id>/answer-key.json` — which is what the
 * prose keys always referred to (`mustFind`, `mustNotFind.rt22_position_is_coherent`,
 * `openQuestions.fdt_minimal_sacrifice`) and which had never been created.
 *
 * Two properties the key files are required to have, and this loader assumes:
 *
 *   - Conjuncts are named as THE CORPUS names them. The key decides WHICH
 *     commitments a theorem involves — that is the published result and is not
 *     up for negotiation — but it states them in the language of the text being
 *     read. A key written in the key-writer's private vocabulary makes the
 *     engine reproduce a paraphrase, which is teaching to the test.
 *   - Every entry cites the corpus line it came from, so the transcription is
 *     auditable rather than trusted.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { settings } from "../config.js";

export interface VerdictAnswerKey {
  corpusId: string;
  source: string;
  mustFind: Array<{
    /** Stable id, as used in the prose key. */
    id: string;
    /** Conjuncts, in the corpus's own vocabulary. */
    stances: string[];
    sourceLine: number;
    /** The sentence these were read from, quoted. */
    corpusPhrase?: string;
  }>;
  mustNotFind: Array<{ id: string; why: string; sourceLine?: number }>;
  passCondition: string;
}

/**
 * Corpora where an unexpected extra contradiction means a bug, not a discovery.
 *
 * reverse-math is fifty years of hand-verified results; its own key says a
 * surplus MUS "is almost certainly an encoding bug". It is also the corpus that
 * would catch a vocabulary extension merging `rt22` into `rt_n_k`, which would
 * make `ramsey_uniform_strength` vanish and the run PASS WHILE BEING WRONG.
 */
export const INVERTED_SCORING_CORPORA = new Set(["reverse-math"]);

/** Read every `corpora/<id>/answer-key.json` that exists. */
export async function loadVerdictAnswerKeys(): Promise<VerdictAnswerKey[]> {
  const corporaDir = join(settings.all.KNOWLEDGE_BASE_PATH, "..", "corpora");
  let dirs: string[];
  try {
    dirs = await readdir(corporaDir);
  } catch {
    return [];
  }
  const keys: VerdictAnswerKey[] = [];
  for (const dir of dirs) {
    try {
      const raw = await readFile(join(corporaDir, dir, "answer-key.json"), "utf8");
      const parsed = JSON.parse(raw) as VerdictAnswerKey & { _README?: unknown };
      delete (parsed as { _README?: unknown })._README;
      // The directory is the identity; a key that disagrees is a filing error.
      keys.push({ ...parsed, corpusId: dir });
    } catch {
      continue;
    }
  }
  return keys;
}
