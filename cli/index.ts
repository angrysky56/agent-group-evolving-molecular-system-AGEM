#!/usr/bin/env node

import { Command } from "commander";
import * as readline from "readline";

const API_URL = "http://localhost:8000/api/v1";

const program = new Command();

program
  .name("agem")
  .description("AGEM CLI Interface")
  .version("1.0.0");

program
  .command("status")
  .description("Show engine status")
  .action(async () => {
    try {
      const res = await fetch(`${API_URL}/system/status`);
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Failed to connect to backend:", error);
    }
  });

program
  .command("models")
  .description("List available models")
  .action(async () => {
    try {
      const res = await fetch(`${API_URL}/system/models`);
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Failed to fetch models:", error);
    }
  });

program
  .command("chat")
  .description("Interactive REPL-style chat")
  .action(async () => {
    console.log("AGEM Chat initialized. Type 'exit' to quit.");
    const sessionId = "cli-session-" + Date.now();
    
    // We get the current config
    let config;
    try {
        const res = await fetch(`${API_URL}/system/config`);
        config = await res.json();
    } catch (e) {
        console.error("Could not fetch config. Ensure backend is running.");
        return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "You: "
    });

    rl.prompt();

    rl.on("line", async (line) => {
      const input = line.trim();
      if (input === "" || input === "exit" || input === "quit") {
        rl.close();
        return;
      }

      process.stdout.write("AGEM: ");
      
      try {
        const response = await fetch(`${API_URL}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: input,
            session_id: sessionId,
            model: config.model,
            provider: config.provider
          })
        });

        if (!response.ok) {
            console.error(`Error: ${response.statusText}`);
            rl.prompt();
            return;
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");
            
            for (const l of lines) {
              if (l.trim().startsWith("data: ")) {
                const dataStr = l.trim().slice(6);
                if (dataStr === "[DONE]") continue;
                try {
                  const data = JSON.parse(dataStr);
                  if (data.type === "chunk") {
                    process.stdout.write(data.delta);
                  } else if (data.type === "agent_event") {
                    process.stdout.write(`\n[Agent ${data.data.agent_id} state updated]\nAGEM: `);
                  }
                } catch (e) {
                  // ignore parse error for incomplete chunks
                }
              }
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
