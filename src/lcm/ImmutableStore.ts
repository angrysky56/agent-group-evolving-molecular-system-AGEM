/**
 * ImmutableStore.ts
 *
 * Append-only, defense-in-depth immutable context store — the foundation of LCM.
 *
 * Immutability is enforced at TWO levels (defense-in-depth):
 *   1. Compile-time: `LCMEntry` has all-readonly fields; `getAll()` returns ReadonlyArray.
 *   2. Runtime: `Object.freeze(entry)` is called BEFORE pushing to the backing array.
 *
 * No update(), delete(), clear(), or reset() methods exist — the store is append-only by design.
 * No LLM inference occurs anywhere in this file.
 *
 * Dependencies:
 *   - uuidv7: time-sortable UUIDs (lexicographic order = insertion order)
 *   - node:crypto: SHA-256 hash for content integrity
 *   - ITokenCounter (injected): deterministic token counting without inference
 */

import { createHash } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import type { LCMEntry, ITokenCounter } from './interfaces.js';

export class ImmutableStore {
  /**
   * Private backing array — holds all frozen LCMEntry objects in insertion order.
   * Using ECMAScript private class fields (#) prevents external subclassing access.
   */
  readonly #entries: LCMEntry[] = [];

  /**
   * Fast O(1) ID lookup index — maps entry.id → index in #entries.
   */
  readonly #idIndex = new Map<string, number>();

  /**
   * Injected token counter — no LLM inference, deterministic BPE encoding.
   */
  readonly #tokenCounter: ITokenCounter;

  constructor(tokenCounter: ITokenCounter) {
    this.#tokenCounter = tokenCounter;
  }

  /**
   * append(content) — the only write operation on ImmutableStore.
   *
   * Creates a fully-specified LCMEntry, freezes it, then stores it.
   * The freeze happens BEFORE the push so no reference to the pre-freeze
   * mutable object escapes.
   *
   * @param content - The text content to store.
   * @returns The frozen, immutable LCMEntry.
   */
  append(content: string): LCMEntry {
    const sequenceNumber = this.#entries.length;

    const entry: LCMEntry = Object.freeze({
      id: uuidv7(),
      content,
      tokenCount: this.#tokenCounter.countTokens(content),
      hash: createHash('sha256').update(content, 'utf8').digest('hex'),
      timestamp: Date.now(),
      sequenceNumber,
    });

    // Index before pushing so #idIndex is always consistent with #entries.
    this.#idIndex.set(entry.id, sequenceNumber);
    this.#entries.push(entry);

    return entry;
  }

  /**
   * get(id) — O(1) lookup of a single entry by UUIDv7 ID.
   *
   * @param id - The UUIDv7 id of the entry.
   * @returns The frozen LCMEntry, or undefined if not found.
   */
  get(id: string): LCMEntry | undefined {
    const index = this.#idIndex.get(id);
    if (index === undefined) return undefined;
    return this.#entries[index];
  }

  /**
   * getAll() — returns all entries as a frozen ReadonlyArray.
   *
   * Defense-in-depth:
   *   - Compile time: ReadonlyArray type prevents push/pop/splice via TypeScript.
   *   - Runtime: Object.freeze() on the returned array prevents mutation via
   *     explicit casts or dynamic property access.
   *
   * Returns a frozen shallow copy so the backing array can still grow on append().
   */
  getAll(): ReadonlyArray<LCMEntry> {
    return Object.freeze([...this.#entries]) as ReadonlyArray<LCMEntry>;
  }

  /**
   * getRange(fromSeq, toSeq) — returns entries with sequenceNumber in [fromSeq, toSeq] inclusive.
   *
   * Since entries are stored in sequenceNumber order, this is a simple array slice.
   *
   * @param fromSeq - Start sequenceNumber (inclusive).
   * @param toSeq   - End sequenceNumber (inclusive).
   * @returns ReadonlyArray of matching entries, in sequenceNumber order.
   */
  getRange(fromSeq: number, toSeq: number): ReadonlyArray<LCMEntry> {
    return this.#entries.slice(fromSeq, toSeq + 1) as ReadonlyArray<LCMEntry>;
  }

  /**
   * size — number of entries currently in the store.
   */
  get size(): number {
    return this.#entries.length;
  }

  /**
   * totalTokens — sum of tokenCount across all entries.
   * Used by EscalationProtocol to determine when to trigger L1/L2/L3.
   */
  get totalTokens(): number {
    return this.#entries.reduce((sum, e) => sum + e.tokenCount, 0);
  }
}
