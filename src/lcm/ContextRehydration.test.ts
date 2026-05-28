import { describe, it, expect, vi } from "vitest";
import { ImmutableStore } from "./ImmutableStore.js";
import { EmbeddingCache } from "./EmbeddingCache.js";
import { LCMClient } from "./LCMClient.js";
import { SummaryIndex } from "./SummaryIndex.js";
import { ContextDAG } from "./ContextDAG.js";
import { GptTokenCounter, MockEmbedder } from "./interfaces.js";
import type { LCMEntry, SummaryNode } from "./interfaces.js";

describe("Context Rehydration & Serialization", () => {
  const tokenCounter = new GptTokenCounter();
  const embedder = new MockEmbedder();

  describe("ImmutableStore.rehydrate", () => {
    it("successfully restores pre-existing frozen entries verbatim", () => {
      const store = new ImmutableStore(tokenCounter);

      const mockEntries: LCMEntry[] = [
        {
          id: "entry-1",
          content: "Factual entry A",
          tokenCount: 3,
          hash: "hash-a",
          timestamp: 123456,
          sequenceNumber: 0,
        },
        {
          id: "entry-2",
          content: "Factual entry B",
          tokenCount: 3,
          hash: "hash-b",
          timestamp: 123457,
          sequenceNumber: 1,
        },
      ];

      store.rehydrate(mockEntries);

      expect(store.size).toBe(2);
      expect(store.get("entry-1")).toEqual(mockEntries[0]);
      expect(store.get("entry-2")).toEqual(mockEntries[1]);
      expect(store.getAll()).toHaveLength(2);
    });

    it("throws if the store is already non-empty", () => {
      const store = new ImmutableStore(tokenCounter);
      store.append("Live entry");

      const mockEntries: LCMEntry[] = [
        {
          id: "entry-1",
          content: "Rehydrated entry",
          tokenCount: 2,
          hash: "hash-c",
          timestamp: 123458,
          sequenceNumber: 0,
        },
      ];

      expect(() => store.rehydrate(mockEntries)).toThrow(/cannot rehydrate a non-empty store/i);
    });

    it("throws if sequence numbers are not strictly ordered", () => {
      const store = new ImmutableStore(tokenCounter);

      const mockEntries: LCMEntry[] = [
        {
          id: "entry-1",
          content: "Out of order entry",
          tokenCount: 3,
          hash: "hash-d",
          timestamp: 123459,
          sequenceNumber: 5, // Invalid! Should be 0
        },
      ];

      expect(() => store.rehydrate(mockEntries)).toThrow(/sequenceNumber mismatch/i);
    });
  });

  describe("EmbeddingCache seeding & snapshotting", () => {
    it("seeds pre-computed embeddings and captures snapshot", () => {
      const cache = new EmbeddingCache(embedder);

      const mockVec1 = [0.1, 0.2, 0.3];
      const mockVec2 = [0.4, 0.5, 0.6];

      cache.seed("entry-1", mockVec1);
      cache.seed("entry-2", new Float64Array(mockVec2));

      expect(cache.size).toBe(2);
      expect(cache.has("entry-1")).toBe(true);
      expect(cache.has("entry-2")).toBe(true);

      const vec1 = cache.getEmbedding("entry-1");
      expect(vec1).toBeDefined();
      expect(Array.from(vec1!)).toEqual(mockVec1);

      const snapshot = cache.snapshot();
      expect(snapshot).toEqual({
        "entry-1": mockVec1,
        "entry-2": mockVec2,
      });
    });
  });

  describe("LCMClient rehydration", () => {
    it("correctly seeds both store and cache verbatim without re-embedding", async () => {
      const store = new ImmutableStore(tokenCounter);
      const cache = new EmbeddingCache(embedder);
      const client = new LCMClient(store, cache, embedder);

      const embedSpy = vi.spyOn(embedder, "embed");

      const mockEntries: LCMEntry[] = [
        {
          id: "entry-1",
          content: "Hello World",
          tokenCount: 2,
          hash: "hash-1",
          timestamp: 123,
          sequenceNumber: 0,
        },
      ];
      const mockEmbeddings = {
        "entry-1": [0.9, 0.8, 0.7],
      };

      client.rehydrate(mockEntries, mockEmbeddings);

      expect(client.store.size).toBe(1);
      expect(client.cache.size).toBe(1);
      expect(Array.from(client.cache.getEmbedding("entry-1")!)).toEqual([0.9, 0.8, 0.7]);

      // Assert embedder was NEVER called (seeding works directly)
      expect(embedSpy).not.toHaveBeenCalled();
    });
  });

  describe("ContextDAG & SummaryIndex snapshot/restore", () => {
    it("captures and restores summary nodes cleanly", () => {
      const store = new ImmutableStore(tokenCounter);
      const index = new SummaryIndex();
      const dag = new ContextDAG(store, index);

      const mockSummary: SummaryNode = {
        id: "summary-1",
        content: "A quick summary",
        originalEntryIds: ["entry-1", "entry-2"],
        createdAt: 1000,
        version: 1,
        metrics: { complexity: "low" },
        metricHistory: [],
        intermediateCompressions: [],
      };

      dag.addSummaryNode(mockSummary);

      expect(dag.getSummaryNode("summary-1")).toBeDefined();

      const snapshot = dag.snapshot();
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0]!.id).toBe("summary-1");

      const newIndex = new SummaryIndex();
      const newDag = new ContextDAG(store, newIndex);
      newDag.restore(snapshot);

      expect(newDag.getSummaryNode("summary-1")).toBeDefined();
      expect(newDag.getSummaryNode("summary-1")!.content).toBe("A quick summary");
    });
  });
});
