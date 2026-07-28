import { GptTokenCounter, type ITokenCounter } from "#agem/lcm/index.js";

export const DEFAULT_SECTION_PATTERN = "^## ";
export const DEFAULT_MAX_SECTIONS = 24;
export const DEFAULT_MIN_SECTION_TOKENS = 32;

export const RUN_AGEM_CYCLE_DESCRIPTION =
  "Ingest one conceptual section into one named subgraph and execute one AGEM iteration. Registry-sheaf cohomology requires at least two connected named subgraphs. For a structured document, prefer run_agem_cycles_sectioned.";

export const RUN_SECTIONED_CYCLES_DESCRIPTION =
  "Split a structured corpus at authored headings, run one sequential cycle per named subgraph, emit per-section SOC, then compute one combined registry-sheaf analysis. Fails if fewer than two sections are found or the bounded section limit is exceeded.";

export interface SectionedIngestionOptions {
  sectionPattern?: string;
  maxSections?: number;
  /** Internal tuning seam; the public tool intentionally fixes this near 200. */
  minSectionTokens?: number;
  /** Injectable so the splitter can be tested without coupling to a tokenizer. */
  tokenCounter?: Pick<ITokenCounter, "countTokens">;
}

export interface PlannedSection {
  heading: string;
  subgraph: string;
  text: string;
  tokenCount: number;
  /** Paragraph-level LCM entries written within this single cycle/subgraph. */
  lcmEntries: string[];
}

interface RawSection {
  heading: string;
  text: string;
}

/** Split a structured corpus into bounded, non-trivial named-cycle inputs. */
export function planSectionedIngestion(
  text: string,
  options: SectionedIngestionOptions = {},
): PlannedSection[] {
  const source = text.trim();
  if (!source) throw new Error("Sectioned ingestion requires non-empty text.");

  const maxSections = options.maxSections ?? DEFAULT_MAX_SECTIONS;
  if (!Number.isInteger(maxSections) || maxSections < 2) {
    throw new Error("maxSections must be an integer of at least 2.");
  }

  const minSectionTokens =
    options.minSectionTokens ?? DEFAULT_MIN_SECTION_TOKENS;
  if (!Number.isInteger(minSectionTokens) || minSectionTokens < 1) {
    throw new Error("minSectionTokens must be a positive integer.");
  }

  const pattern = options.sectionPattern?.trim() || DEFAULT_SECTION_PATTERN;
  let splitter: RegExp;
  try {
    splitter = new RegExp(pattern, "gm");
  } catch (error) {
    throw new Error(
      `Invalid sectionPattern: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const matches = [...source.matchAll(splitter)];
  if (matches.some((match) => match[0].length === 0)) {
    throw new Error("sectionPattern must consume at least one character.");
  }
  if (matches.length > maxSections) {
    throw new Error(
      `Section split found ${matches.length} headings, exceeding maxSections=${maxSections}.`,
    );
  }

  const raw: RawSection[] = [];
  const firstIndex = matches[0]?.index ?? source.length;
  const preamble = source.slice(0, firstIndex).trim();
  matches.forEach((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? source.length;
    const sectionText = source.slice(start, end).trim();
    if (sectionText) {
      raw.push({
        heading: inferHeading(sectionText, `Section ${index + 1}`),
        text: sectionText,
      });
    }
  });
  if (preamble) {
    const targetLevel = headingLevelFromPattern(pattern);
    const ownsSubgraph =
      targetLevel !== null &&
      [...preamble.matchAll(/^(#{2,6})\s+(.+)$/gm)].some(
        (heading) => heading[1]!.length < targetLevel,
      );
    if (ownsSubgraph || raw.length === 0) {
      raw.unshift({
        heading: inferPreambleHeading(preamble, "Preamble"),
        text: preamble,
      });
    } else {
      raw[0] = { ...raw[0]!, text: `${preamble}\n\n${raw[0]!.text}` };
    }
  }

  const tokenCounter = options.tokenCounter ?? new GptTokenCounter();
  const merged: RawSection[] = [];
  let pending: string[] = [];
  for (let index = 0; index < raw.length; index++) {
    const section = raw[index]!;
    const tokenCount = tokenCounter.countTokens(section.text);
    if (tokenCount < minSectionTokens && index < raw.length - 1) {
      pending.push(section.text);
      continue;
    }
    merged.push({
      heading: section.heading,
      text: [...pending, section.text].join("\n\n"),
    });
    pending = [];
  }
  if (pending.length > 0) {
    if (merged.length === 0) {
      merged.push({ heading: raw.at(-1)?.heading ?? "Section", text: pending.join("\n\n") });
    } else {
      merged[merged.length - 1] = {
        ...merged[merged.length - 1]!,
        text: `${merged[merged.length - 1]!.text}\n\n${pending.join("\n\n")}`,
      };
    }
  }

  if (merged.length < 2) {
    throw new Error(
      `Section split yielded ${merged.length} runnable section; cohomology requires at least 2 named subgraphs. Check sectionPattern or provide a larger corpus.`,
    );
  }
  if (merged.length > maxSections) {
    throw new Error(
      `Section split yielded ${merged.length} runnable sections, exceeding maxSections=${maxSections}.`,
    );
  }

  const usedSlugs = new Set<string>();
  return merged.map((section, index) => ({
    heading: section.heading,
    subgraph: uniqueSlug(section.heading, index, usedSlugs),
    text: section.text,
    tokenCount: tokenCounter.countTokens(section.text),
    lcmEntries: paragraphEntries(section.text, tokenCounter),
  }));
}

function inferHeading(text: string, fallback: string): string {
  const headings = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)];
  return headings.at(-1)?.[1]?.trim() || fallback;
}

function inferPreambleHeading(text: string, fallback: string): string {
  const headings = [...text.matchAll(/^(#{2,6})\s+(.+)$/gm)];
  return headings[0]?.[2]?.trim() || inferHeading(text, fallback);
}

function headingLevelFromPattern(pattern: string): number | null {
  return pattern.match(/^\^(#{1,6})/)?.[1]?.length ?? null;
}

function uniqueSlug(heading: string, index: number, used: Set<string>): string {
  const base =
    heading
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || `section-${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

function paragraphEntries(
  text: string,
  tokenCounter: Pick<ITokenCounter, "countTokens">,
): string[] {
  const blocks = text
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  const entries: string[] = [];
  let pending: string[] = [];
  blocks.forEach((block, index) => {
    if (tokenCounter.countTokens(block) < 12 && index < blocks.length - 1) {
      pending.push(block);
      return;
    }
    entries.push([...pending, block].join("\n\n"));
    pending = [];
  });
  if (pending.length > 0) {
    if (entries.length > 0) {
      entries[entries.length - 1] = `${entries[entries.length - 1]}\n\n${pending.join("\n\n")}`;
    } else {
      entries.push(pending.join("\n\n"));
    }
  }
  return entries.length > 0 ? entries : [text];
}
