import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRunLogger } from "./run-logger.js";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("run logger", () => {
  it("persists assistant turn content and compression telemetry", () => {
    const basePath = mkdtempSync(join(tmpdir(), "agem-run-log-"));
    temporaryPaths.push(basePath);
    const logger = createRunLogger({
      model: "test-model",
      message: "test",
      basePath,
    });

    logger.turn(3, {
      content: "intermediate hypothesis",
      toolNames: ["get_agem_state"],
      inputMessageCount: 12,
      compressedMessageCount: 7,
      usage: { total_tokens: 42 },
    });

    const events = readFileSync(logger.jsonlPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({
      type: "turn",
      turn: 3,
      content: "intermediate hypothesis",
      toolNames: ["get_agem_state"],
      inputMessageCount: 12,
      compressedMessageCount: 7,
    });
  });
});
