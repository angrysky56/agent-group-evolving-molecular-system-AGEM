/**
 * config-persist.test.ts
 *
 * Pins the rule that the suite itself broke: a test run must never modify the
 * developer's .env.
 *
 * config.test.ts calls `settings.update({ EMBEDDING_PROVIDER: "ollama" })`, and
 * update() persists to the real project-root .env. Every `npm test` therefore
 * rewrote the live configuration — reverting a deliberate provider switch over
 * and over while reporting all green, which is exactly the shape of bug that
 * takes hours to attribute because the evidence points at the UI.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { settings } from "./config.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ENV_PATH = resolve(PROJECT_ROOT, ".env");

describe("ConfigService — .env is never written during tests", () => {
  it("leaves the real .env byte-identical across an update()", () => {
    if (!existsSync(ENV_PATH)) return; // nothing to protect in CI

    const before = readFileSync(ENV_PATH, "utf-8");
    const mtimeBefore = statSync(ENV_PATH).mtimeMs;

    settings.update({ EMBEDDING_PROVIDER: "ollama" });
    settings.update({ OPENROUTER_EMBEDDING_MODEL: "test/should-not-persist" });

    expect(readFileSync(ENV_PATH, "utf-8")).toBe(before);
    expect(statSync(ENV_PATH).mtimeMs).toBe(mtimeBefore);
  });

  it("still applies the update in memory, so tests assert something real", () => {
    // Suppressing the write must not turn update() into a no-op — otherwise
    // the fix would quietly invalidate every other config assertion.
    settings.update({ EMBEDDING_PROVIDER: "openrouter" });
    expect(settings.toSystemConfig().embedding_provider).toBe("openrouter");

    settings.update({ EMBEDDING_PROVIDER: "ollama" });
    expect(settings.toSystemConfig().embedding_provider).toBe("ollama");
  });
});
