#!/usr/bin/env node
/**
 * AGEM CLI.
 *
 * The previous version exposed exactly one way to reason with the engine — an
 * interactive readline REPL — so anything automated (feeding a corpus file,
 * scripting a run, diffing two analyses, letting an agent drive AGEM) was
 * impossible. Everything had to be typed into the web UI and copied back out
 * by hand, which is a slow and lossy way to find out what the engine did.
 *
 * This version adds a non-interactive path. `agem ask` takes a prompt or a
 * file, streams the run, and exits with a status code. Prose goes to stdout;
 * progress and tool activity go to stderr, so `agem ask --file corpus.md >
 * report.md` yields a clean report and `2>trace.log` keeps the trace.
 */

import { Command } from "commander";
import * as readline from "readline";
import { readFileSync } from "node:fs";

const API_URL = process.env.AGEM_API_URL ?? "http://localhost:8000/api/v1";

const program = new Command();
program
  .name("agem")
  .description("AGEM CLI — reason with the engine from a shell or a script")
  .version("1.1.0");

/** Print JSON, or die with a useful message if the backend is not up. */
async function getJson(pathname: string): Promise<unknown> {
  const res = await fetch(`${API_URL}${pathname}`).catch((e) => {
    console.error(
      `Cannot reach AGEM at ${API_URL} — is the backend running?\n  ${e?.message ?? e}`,
    );
    process.exit(2);
  });
  if (!res.ok) {
    console.error(`${pathname} → HTTP ${res.status} ${res.statusText}`);
    process.exit(2);
  }
  return res.json();
}

function registerRead(name: string, pathname: string, description: string) {
  program
    .command(name)
    .description(description)
    .action(async () => {
      console.log(JSON.stringify(await getJson(pathname), null, 2));
    });
}

registerRead("status", "/system/status", "Engine status");
registerRead("state", "/system/state", "Full engine state (graph, cohomology, iteration)");
registerRead("soc", "/system/soc", "SOC metrics (VNE, EE, CDP, regime)");
registerRead("config", "/system/config", "Active provider and model");
registerRead("models", "/system/models", "Available models");

program
  .command("ask")
  .description("Run one non-interactive turn. Prose to stdout, trace to stderr.")
  .argument("[prompt...]", "Prompt text (or use --file)")
  .option("-f, --file <path>", "Read the prompt from a file (e.g. a corpus)")
  .option("-p, --prefix <text>", "Text prepended to file contents, e.g. an instruction")
  .option("-s, --session <id>", "Session id (default: a fresh one per invocation)")
  .option("-m, --model <model>", "Override the configured model")
  .option("--provider <provider>", "Override the configured provider")
  .option("--json", "Emit one JSON object per SSE event instead of prose", false)
  .option("-q, --quiet", "Suppress the stderr trace", false)
  .option("-t, --timeout <seconds>", "Abort after N seconds", "1800")
  .action(async (promptParts: string[], opts) => {
    let prompt = (promptParts ?? []).join(" ").trim();
    if (opts.file) {
      const body = readFileSync(opts.file, "utf8");
      prompt = opts.prefix ? `${opts.prefix}\n\n${body}` : body;
    }
    if (!prompt) {
      console.error("Nothing to ask. Provide a prompt or --file.");
      process.exit(1);
    }

    const config = (await getJson("/system/config")) as {
      model?: string;
      provider?: string;
    };

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Number(opts.timeout) * 1000,
    );

    const trace = (msg: string) => {
      if (!opts.quiet) process.stderr.write(msg);
    };

    let res: Response;
    try {
      res = await fetch(`${API_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          message: prompt,
          session_id: opts.session ?? `cli-${Date.now()}`,
          model: opts.model ?? config.model,
          provider: opts.provider ?? config.provider,
        }),
      });
    } catch (e: any) {
      clearTimeout(timer);
      console.error(
        e?.name === "AbortError"
          ? `Timed out after ${opts.timeout}s.`
          : `Request failed: ${e?.message ?? e}`,
      );
      process.exit(2);
    }

    if (!res.ok || !res.body) {
      clearTimeout(timer);
      console.error(`HTTP ${res.status} ${res.statusText}`);
      process.exit(2);
    }

    /*
     * The backend speaks NAMED SSE events: `event: <name>\ndata: <json>`.
     * The discriminator is the event line, not a field inside data — and both
     * `token` and `thinking` carry `{content}`. A parser that ignores the
     * event name therefore prints the model's reasoning as if it were the
     * answer, which is what the previous CLI did.
     */
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawContent = false;
    let answer = "";
    let pendingEvent = "message";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const t = line.trimEnd();
        if (t.startsWith("event: ")) {
          pendingEvent = t.slice(7).trim();
          continue;
        }
        if (!t.startsWith("data: ")) continue;
        const payload = t.slice(6);
        const name = pendingEvent;

        let evt: any;
        try {
          evt = JSON.parse(payload);
        } catch {
          continue; // partial frame
        }

        if (opts.json) {
          console.log(JSON.stringify({ event: name, data: evt }));
          continue;
        }

        switch (name) {
          case "token":
            if (typeof evt.content === "string") {
              process.stdout.write(evt.content);
              answer += evt.content;
              sawContent = true;
            }
            break;
          case "thinking":
            // Reasoning, not the answer. Trace only.
            if (typeof evt.content === "string") trace(evt.content);
            break;
          case "clear_stream":
            // The engine retracts what it streamed so far (e.g. a tool turn
            // supersedes it). Mirror that instead of concatenating both.
            answer = "";
            sawContent = false;
            trace("\n[stream reset]\n");
            break;
          case "tool_result":
            trace(`\n[tool] ${evt.name ?? evt.tool ?? "?"}\n`);
            break;
          case "artifact":
            trace(`\n[artifact] ${evt.path ?? evt.name ?? ""}\n`);
            break;
          case "agem_state":
            trace(
              `\n[state] iteration=${evt.iteration ?? "?"} ` +
                `communities=${evt.communities ?? "?"}\n`,
            );
            break;
          case "usage":
            trace(`\n[usage] ${JSON.stringify(evt)}\n`);
            break;
          case "session":
            trace(`[session ${evt.session_id ?? "?"}]\n`);
            break;
          case "error":
            clearTimeout(timer);
            console.error(
              `\nEngine error: ${evt.message ?? evt.error ?? JSON.stringify(evt)}`,
            );
            process.exit(3);
            break;
          case "done":
            trace("\n[done]\n");
            break;
          default:
            trace(`\n[${name}]\n`);
        }
      }
    }

    clearTimeout(timer);
    if (!opts.json && sawContent) process.stdout.write("\n");
    // Exit non-zero on an empty answer so a script notices a silent failure
    // rather than writing a zero-byte report and calling it success.
    if (!opts.json && !sawContent) {
      console.error("No answer content was produced.");
      process.exit(4);
    }
    process.exit(0);
  });

program
  .command("chat")
  .description("Interactive REPL")
  .action(async () => {
    console.log("AGEM chat. 'exit' to quit.");
    const sessionId = `cli-${Date.now()}`;
    const config = (await getJson("/system/config")) as {
      model?: string;
      provider?: string;
    };

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "You: ",
    });
    rl.prompt();

    rl.on("line", async (line) => {
      const input = line.trim();
      if (!input || input === "exit" || input === "quit") return rl.close();
      process.stdout.write("AGEM: ");
      try {
        const response = await fetch(`${API_URL}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: input,
            session_id: sessionId,
            model: config.model,
            provider: config.provider,
          }),
        });
        if (!response.ok || !response.body) {
          console.error(`Error: ${response.statusText}`);
          return rl.prompt();
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let replEvent = "message";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const l of lines) {
            const t = l.trimEnd();
            // Named SSE events: only `token` is the answer. `thinking` also
            // carries {content} and must not be printed as the reply.
            if (t.startsWith("event: ")) { replEvent = t.slice(7).trim(); continue; }
            if (!t.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(t.slice(6));
              if (replEvent === "token" && typeof evt.content === "string")
                process.stdout.write(evt.content);
            } catch {
              /* partial frame */
            }
          }
        }
        console.log();
      } catch (error) {
        console.error("\nFailed to send message:", error);
      }
      rl.prompt();
    }).on("close", () => {
      console.log("Exiting chat.");
      process.exit(0);
    });
  });

program.parse();
