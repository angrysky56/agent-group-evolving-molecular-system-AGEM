import { describe, expect, it } from "vitest";
import { SseDecoder } from "./sse";

describe("SseDecoder", () => {
  it("dispatches a valid final done frame even without a trailing blank line", () => {
    const decoder = new SseDecoder();
    expect(
      decoder.push(
        'event: done\ndata: {"message":{"id":"assistant-1","role":"assistant","content":"complete"}}',
        true,
      ),
    ).toEqual([
      {
        event: "done",
        data: {
          message: {
            id: "assistant-1",
            role: "assistant",
            content: "complete",
          },
        },
      },
    ]);
  });
});
