/**
 * glossary-store.ts — cast the sieve once, keep it, reuse it.
 *
 * The problem it solves
 * ---------------------
 * The closed vocabulary was regenerated from scratch on every run, so the
 * instrument's divisions moved between measurements. Two consecutive runs over
 * the SAME corpus produced 46 glossary entries then 34; 55 accepted claims then
 * 15. That variance is not in the material. It is in the gauge, and a gauge
 * that changes between readings cannot be scored against an answer key — a
 * pass could be a lucky casting and a failure an unlucky one.
 *
 * Hobbes's condition is `generall names AGREED UPON`. Agreed means settled and
 * shared, not re-derived each time one reasons. This is the store where the
 * agreement lives.
 *
 * The guard against a dead sieve
 * ------------------------------
 * "Axiomatic geometry and logic form empty conceptual schemata until they are
 * stripped of their merely logical-formal character by the co-ordination of
 * real objects of experience." — Einstein
 *
 * A frozen vocabulary that has stopped touching the text is exactly that empty
 * schema: it would fit anything and measure nothing. So the cache is keyed on
 * a hash of the CORPUS, not on its name. Change the text and the sieve is
 * recast. Reuse only ever applies to the material it was cut for.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClosedGlossaryEntry } from "./claim-extractor.js";
import { settings } from "../config.js";

export interface PersistedGlossary {
  corpusId: string;
  /** SHA-256 of the corpus text this vocabulary was cut for. */
  corpusHash: string;
  entries: ClosedGlossaryEntry[];
  createdAt: string;
  /** How many extension rounds have added to it since it was first cast. */
  extendedTimes: number;
}

/**
 * Never touch the real knowledge base from a test run.
 *
 * Within minutes of adding this store, a unit test wrote
 * `knowledge_base/glossaries/decision-theory.json` and a later test in the
 * same suite REUSED it, silently changing what that test measured. That is the
 * `.env` clobbering incident again in a new costume — see
 * docs/ENGINEERING-HANDOFF.md §5, "config.test.ts rewrote the real .env on
 * every test run".
 *
 * A cache that persists across test runs makes the suite order-dependent and
 * quietly non-deterministic, which is worse than having no cache at all.
 */
function persistenceDisabled(): boolean {
  return !!process.env.VITEST || process.env.NODE_ENV === "test";
}

function storeDir(): string {
  return join(settings.all.KNOWLEDGE_BASE_PATH, "glossaries");
}

function storePath(corpusId: string): string {
  const safe = corpusId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(storeDir(), `${safe}.json`);
}

/**
 * The reviewed alias map that ships beside a corpus, if there is one.
 *
 * `corpora/<id>/ontology.json` maps alias → canonical and is written by a
 * person. Keys beginning `_` are notes to the reader, not mappings — most
 * importantly `_DO_NOT_MERGE`, which reverse-math uses to record that
 * `rt22` and `rt_n_k` must never be aliased because the merge destroys the
 * corpus. Those entries are skipped as data and left for the human they were
 * addressed to.
 *
 * Returns `{}` when there is no file. A corpus with no agreed names simply has
 * none; that is not an error, it is the state most corpora arrive in.
 */
export async function loadCorpusOntology(
  corpusText: string,
): Promise<Record<string, string>> {
  /*
   * Matched on the TEXT, not on the corpus id.
   *
   * The id is invented by the model, not derived from anything on disk:
   * `corpora/quantum-mind-genesis` came back as
   * `quantum-mind-genetic-code-synthesis`, and `qm-interpretations` as
   * `interpretations-of-quantum-mechanics`. A first version looked the
   * ontology up by id and therefore never found a single one — the fix
   * silently did nothing while appearing to work, which is the failure mode
   * this whole session keeps producing.
   *
   * So identify the corpus by something it cannot rename: its own opening
   * heading, matched exactly against the text being ingested. No fuzzy
   * matching — a wrong ontology is worse than none, because it would merge
   * concepts a human deliberately separated.
   */
  const dir = await identifyCorpus(corpusText);
  if (!dir) return {};
  try {
    const parsed = JSON.parse(
      await readFile(
        join(settings.all.KNOWLEDGE_BASE_PATH, "..", "corpora", dir, "ontology.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([alias, canonical]) =>
        !alias.startsWith("_") &&
        typeof canonical === "string" &&
        canonical.trim()
          ? [[alias, canonical]]
          : [],
      ),
    );
  } catch {
    return {};
  }
}

/**
 * Which corpus on disk is this text, if any?
 *
 * Identified by the corpus file's own opening heading, matched exactly. Not by
 * the corpus id, which the model chooses from the content and which therefore
 * varies: `corpora/quantum-mind-genesis` has been called
 * `quantum-mind-genetic-code` and `quantum-mind-genetic-code-synthesis` on
 * different runs. Those names are reasonable — they describe the material —
 * but they are not an identity you can key storage on.
 */
export async function identifyCorpus(text: string): Promise<string | null> {
  const corporaDir = join(settings.all.KNOWLEDGE_BASE_PATH, "..", "corpora");
  let dirs: string[];
  try {
    dirs = await readdir(corporaDir);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    try {
      const corpus = await readFile(join(corporaDir, dir, "corpus.md"), "utf8");
      const heading = corpus.split("\n")[0]?.trim() ?? "";
      // Long enough to be distinctive; a short heading could collide.
      if (heading.length >= 12 && text.includes(heading)) return dir;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * The memory namespace this material should read from and write to.
 *
 * `session:<uuid>` was the default, and the namespace is a HARD retrieval
 * boundary — "similarity never crosses it unless opted in". Since the CLI and
 * the UI mint a new session per run, every finding was written into a
 * namespace no later run would ever query. Measured: a validated
 * no-contradiction verdict over 17 blocks was stored at 06:39, and the same
 * corpus re-analysed at 20:12 recalled nothing and derived it again.
 *
 * A corpus is the natural unit of continuity: a verdict about this corpus is
 * exactly what a later run about this corpus should see. So material with a
 * document identity gets a shared, corpus-scoped namespace.
 *
 * Material WITHOUT one keeps session isolation. A conversation is not a
 * corpus, and the boundary exists for good reason — this widens it only where
 * there is a stable subject to widen it to.
 */
export async function resolveMemoryNamespace(
  text: string,
  sessionId: string,
  explicit?: string,
): Promise<string> {
  const supplied = explicit?.trim();
  if (supplied) return supplied;

  const dir = await identifyCorpus(text);
  if (dir) return `corpus:${dir}`;

  // An H1 is a weaker identity than a corpus file, but it is still a stable
  // subject — the same pasted document recalls its own prior findings.
  const heading = text
    .split("\n")
    .find((line) => line.trim().startsWith("# "))
    ?.replace(/^#\s*/, "")
    .trim();
  if (heading && heading.length >= 12) {
    return `corpus:${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)}`;
  }
  return `session:${sessionId}`;
}

export function corpusHash(segments: readonly { text: string }[]): string {
  return createHash("sha256")
    .update(segments.map((segment) => segment.text).join("\n"), "utf8")
    .digest("hex");
}

/**
 * The vocabulary previously agreed for this exact corpus, if any.
 *
 * Returns null on a hash mismatch rather than adapting the old sieve to new
 * text — a vocabulary cut for different material is not evidence about this
 * material, and quietly reusing it is how a stale schema starts fitting
 * everything.
 */
export async function loadPersistedGlossary(
  corpusId: string,
  hash: string,
): Promise<PersistedGlossary | null> {
  if (persistenceDisabled()) return null;
  try {
    const raw = await readFile(storePath(corpusId), "utf8");
    const parsed = JSON.parse(raw) as PersistedGlossary;
    if (parsed.corpusHash !== hash) return null;
    if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function persistGlossary(
  corpusId: string,
  hash: string,
  entries: readonly ClosedGlossaryEntry[],
  extendedTimes = 0,
): Promise<void> {
  if (entries.length === 0 || persistenceDisabled()) return;
  await mkdir(storeDir(), { recursive: true });
  const record: PersistedGlossary = {
    corpusId,
    corpusHash: hash,
    entries: [...entries],
    createdAt: new Date().toISOString(),
    extendedTimes,
  };
  await writeFile(storePath(corpusId), JSON.stringify(record, null, 2), "utf8");
}
