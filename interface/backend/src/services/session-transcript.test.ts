/**
 * The transcript must contain what the PERSON said and what the engine DID —
 * and nothing the engine said to itself wearing the person's role.
 *
 * Symptom: "it started disappearing all the work and tool calls prior to the
 * summary". Nothing was lost — session c105d7a9 held all 14 messages including
 * every tool call — but the second-to-last entry was:
 *
 *   role: "user", 2677 chars, "Typed claim verification is inconclusive.
 *   Do not call or request more tools..."
 *
 * An engine directive persisted as a user turn, sitting immediately before the
 * final summary. Any view rendering from the latest user turn onward showed
 * the summary and hid the work behind a message the user never wrote.
 */

import { describe, expect, it } from "vitest";

interface HistoryMessage {
  role: string;
  content: string;
  engineDirective?: boolean;
  tool_calls?: unknown[];
}

/** The filter as `chat.ts` applies it before `sessionStore.update`. */
function transcript(messages: readonly HistoryMessage[]): HistoryMessage[] {
  return messages.filter(
    (m) => m.role !== "system" && !m.engineDirective,
  );
}

/** Shape of the real session that exhibited the bug. */
const RUN: HistoryMessage[] = [
  { role: "system", content: "You are AGEM…" },
  { role: "user", content: "## Answer key — distinctions the auditor must protect…" },
  { role: "assistant", content: "I'll ingest the corpus…", tool_calls: [{}] },
  { role: "tool", content: "Sectioned corpus run completed…" },
  { role: "assistant", content: "Let me inspect the graph…", tool_calls: [{}, {}, {}] },
  { role: "tool", content: '{"communities":[…]}' },
  { role: "assistant", content: "Now the formal verification…", tool_calls: [{}] },
  { role: "tool", content: '{"runLogId":"…","verdictKind":"inconclusive"}' },
  {
    role: "user",
    engineDirective: true,
    content: "Typed claim verification is inconclusive. Do not call or request more tools.",
  },
  { role: "assistant", content: "## AGEM Analysis: Consciousness Distinctions…" },
];

describe("the saved transcript", () => {
  it("keeps every tool call and result", () => {
    const saved = transcript(RUN);
    expect(saved.filter((m) => m.role === "tool")).toHaveLength(3);
    expect(
      saved.filter((m) => (m.tool_calls?.length ?? 0) > 0),
    ).toHaveLength(3);
  });

  it("contains exactly one user message — the one the person wrote", () => {
    const users = transcript(RUN).filter((m) => m.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0]!.content).toMatch(/^## Answer key/);
  });

  it("never persists an engine directive as something the person said", () => {
    expect(
      transcript(RUN).some((m) =>
        m.content.includes("Do not call or request more tools"),
      ),
    ).toBe(false);
  });

  it("leaves no engine directive between the work and the summary", () => {
    /*
     * The mechanism of the disappearance: with the directive present, the last
     * user turn was the directive, so "render from the latest user turn" hid
     * everything above it. Without it, the last user turn is the corpus and
     * the whole run renders.
     */
    const saved = transcript(RUN);
    const lastUser = saved.map((m) => m.role).lastIndexOf("user");
    const afterLastUser = saved.slice(lastUser);
    expect(afterLastUser.filter((m) => m.role === "tool").length).toBe(3);
  });

  it("still drops system messages, as it always did", () => {
    expect(transcript(RUN).some((m) => m.role === "system")).toBe(false);
  });

  it("keeps a genuine follow-up question from the person", () => {
    const withFollowUp = [
      ...RUN,
      { role: "user", content: "Why did extraction fail?" },
    ];
    const users = transcript(withFollowUp).filter((m) => m.role === "user");
    expect(users).toHaveLength(2);
    expect(users[1]!.content).toBe("Why did extraction fail?");
  });
});
