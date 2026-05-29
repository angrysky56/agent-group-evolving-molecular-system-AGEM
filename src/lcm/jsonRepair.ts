/**
 * jsonRepair.ts
 *
 * Pure helpers for recovering from mid-tier LLM JSON malformations.
 *
 * The two failure shapes we see in real runs:
 *   1. Provider returns empty content -> caller must use a fallback that
 *      doesn't corrupt downstream (sentence-boundary truncation, not
 *      mid-character slicing).
 *   2. Provider returns JSON with trailing commas, single-quoted strings,
 *      surrounding prose, or code fences (e.g. "Expected ',' or '}' at
 *      position 477"). The right move is to LOCATE the bracketed array,
 *      apply small repairs, and retry parsing -- not to give up.
 *
 * These helpers are pure (no I/O, no time, no provider) so they live in
 * src/lcm/ where the main vitest config picks them up. The backend
 * provider-compressor imports them.
 */

/**
 * extractJsonArray -- locate and parse the first JSON array in `raw`,
 * tolerating common mid-model failure modes:
 *   - Surrounding prose / code fences (```json ... ```)
 *   - Trailing commas before `]` or `}`
 *   - Single-quoted strings (where unambiguous)
 *
 * Returns the parsed array, or null if no recoverable JSON.
 *
 * Why bracket-counting instead of regex: a regex either matches too greedily
 * (eats trailing prose) or too narrowly (misses nested objects). A bracket
 * counter that respects double-quoted regions handles arbitrary nesting and
 * stops exactly at the matching `]`.
 */
export function extractJsonArray(raw: string): unknown[] | null {
  if (!raw || raw.trim().length === 0) return null;

  // Strip code fences. Catches both ```json and bare ```.
  let s = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

  // Locate the first '[' and the matching ']' by depth counting.
  const start = s.indexOf("[");
  if (start < 0) return null;

  const end = findMatchingClose(s, start, "[", "]");
  if (end < 0) return null;

  let candidate = s.slice(start, end + 1);

  // Repair 1: drop trailing commas before `]` and `}` (most common JS-isms).
  candidate = candidate.replace(/,(\s*[\]}])/g, "$1");

  // Repair 2: convert unambiguously-single-quoted strings to double-quoted.
  candidate = convertSingleQuotedStrings(candidate);

  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * findMatchingClose -- given a string and the index of an opening bracket,
 * find the index of the matching closing bracket, respecting nesting AND
 * double-quoted string regions. Returns -1 if no match.
 *
 * Exported for testing; also reused if we add object-extraction later.
 */
export function findMatchingClose(
  s: string,
  openIdx: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * convertSingleQuotedStrings -- replace single-quoted string literals with
 * double-quoted equivalents, leaving existing double-quoted content alone.
 *
 * Conservative rules:
 *   - Inside an active double-quoted region: do nothing.
 *   - Outside: match `'...'` whose interior contains no `"` or newline.
 *     If the interior has either, skip (ambiguous -- likely apostrophe in
 *     prose, e.g. "don't").
 */
export function convertSingleQuotedStrings(s: string): string {
  let out = "";
  let inDouble = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      out += ch + (s[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (ch === '"') {
      inDouble = !inDouble;
      out += ch;
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) {
      // Find the matching closing single quote without crossing " or newline.
      let j = i + 1;
      let safe = true;
      while (j < s.length && s[j] !== "'") {
        if (s[j] === '"' || s[j] === "\n") {
          safe = false;
          break;
        }
        if (s[j] === "\\") j++; // skip escaped char
        j++;
      }
      if (safe && j < s.length && s[j] === "'") {
        out += '"' + s.slice(i + 1, j) + '"';
        i = j + 1;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * sentenceBoundaryTruncate -- truncate `text` to approximately `ratio` of its
 * length, cutting only at a sentence boundary (".", "?", "!" + whitespace).
 *
 * If no boundary exists in the back half of the target window, returns the
 * full text. Mid-character slicing produces unreadable summaries that poison
 * downstream embeddings, so "no truncation" is strictly better than "mangled
 * truncation" -- the lumpability auditor will flag oversize summaries
 * separately if that becomes a problem.
 */
export function sentenceBoundaryTruncate(text: string, ratio: number): string {
  if (!text) return text;
  const targetLength = Math.max(1, Math.floor(text.length * ratio));
  if (text.length <= targetLength) return text;

  const slice = text.slice(0, targetLength);
  const candidates = [
    slice.lastIndexOf(". "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf(".\n"),
    slice.lastIndexOf("?\n"),
    slice.lastIndexOf("!\n"),
  ];
  const boundary = Math.max(...candidates);

  // Only accept a boundary in the back half -- a boundary near the start
  // would produce a too-short fragment.
  if (boundary > targetLength / 2) {
    return text.slice(0, boundary + 1).trim();
  }

  // No good boundary -- return the full text rather than a mangled fragment.
  return text;
}
