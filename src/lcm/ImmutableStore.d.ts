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
import type { LCMEntry, ITokenCounter } from "./interfaces.js";
export declare class ImmutableStore {
    #private;
    constructor(tokenCounter: ITokenCounter);
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
    append(content: string): LCMEntry;
    /**
     * get(id) — O(1) lookup of a single entry by UUIDv7 ID.
     *
     * @param id - The UUIDv7 id of the entry.
     * @returns The frozen LCMEntry, or undefined if not found.
     */
    get(id: string): LCMEntry | undefined;
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
    getAll(): ReadonlyArray<LCMEntry>;
    /**
     * getRange(fromSeq, toSeq) — returns entries with sequenceNumber in [fromSeq, toSeq] inclusive.
     *
     * Since entries are stored in sequenceNumber order, this is a simple array slice.
     *
     * @param fromSeq - Start sequenceNumber (inclusive).
     * @param toSeq   - End sequenceNumber (inclusive).
     * @returns ReadonlyArray of matching entries, in sequenceNumber order.
     */
    getRange(fromSeq: number, toSeq: number): ReadonlyArray<LCMEntry>;
    /**
     * size — number of entries currently in the store.
     */
    get size(): number;
    /**
     * totalTokens — sum of tokenCount across all entries.
     * Used by EscalationProtocol to determine when to trigger L1/L2/L3.
     */
    get totalTokens(): number;
}
//# sourceMappingURL=ImmutableStore.d.ts.map