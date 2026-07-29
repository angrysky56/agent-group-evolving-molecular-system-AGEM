import { describe, expect, it } from "vitest";
import { selectFinalAssistantContent } from "./chat-stream";

describe("chat stream finalization", () => {
  it("keeps the backend final response authoritative over longer intermediate narration", () => {
    const intermediate = "provisional analysis\n".repeat(100);

    expect(
      selectFinalAssistantContent("PARTIAL — derive remains unmet.", intermediate),
    ).toBe("PARTIAL — derive remains unmet.");
  });
});
