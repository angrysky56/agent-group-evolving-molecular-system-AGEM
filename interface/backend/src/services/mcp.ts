import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs/promises";
import path from "path";

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

export class MCPManager {
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, StdioClientTransport> = new Map();
  private mcpJsonPath: string;

  constructor(basePath: string) {
    this.mcpJsonPath = path.resolve(basePath, "../../mcp.json");
  }

  async initialize() {
    try {
      const content = await fs.readFile(this.mcpJsonPath, "utf-8");
      const config: MCPConfig = JSON.parse(content);

      if (!config.mcpServers) {
        console.log("[MCP] No mcpServers defined in mcp.json");
        return;
      }

      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        await this.connectServer(name, serverConfig);
      }
    } catch (error: any) {
      if (error.code === "ENOENT") {
        console.log("[MCP] No mcp.json found, skipping MCP initialization.");
      } else {
        console.error("[MCP] Failed to initialize MCP:", error.message);
      }
    }
  }

  private async connectServer(name: string, config: MCPServerConfig) {
    console.log(`[MCP] Connecting to server '${name}'...`);
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: config.env,
    });

    const client = new Client(
      { name: "agem-mcp-client", version: "0.1.0" },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);
      this.clients.set(name, client);
      this.transports.set(name, transport);
      console.log(`[MCP] Successfully connected to '${name}'`);
    } catch (error: any) {
      console.error(
        `[MCP] Failed to connect to server '${name}':`,
        error.message,
      );
    }
  }

  async getAllTools() {
    const allTools: any[] = [];
    for (const [name, client] of this.clients.entries()) {
      try {
        const response: any = await client.listTools();
        const tools = response.tools || [];
        for (const tool of tools) {
          allTools.push({
            type: "function",
            function: {
              name: `mcp__${name}__${tool.name}`,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          });
        }
      } catch (error: any) {
        console.error(
          `[MCP] Failed to list tools for '${name}':`,
          error.message,
        );
      }
    }
    return allTools;
  }

  /** Get names of all connected servers. */
  getServerNames(): string[] {
    return [...this.clients.keys()];
  }

  /** Get tools for a specific server with name + description (for meta-tool discovery). */
  async getServerTools(serverName: string): Promise<Array<{ name: string; description: string }>> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP Server '${serverName}' not connected.`);
    }
    const response: any = await client.listTools();
    return (response.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description ?? "",
    }));
  }

  async executeTool(serverName: string, toolName: string, args: any) {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP Server '${serverName}' not connected.`);
    }

    try {
      const response: any = await client.callTool({
        name: toolName,
        arguments: args,
      });

      if (response && response.content) {
        // Concatenate text content
        return response.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n");
      }
      return "Executed successfully, but no text response returned.";
    } catch (error: any) {
      console.error(
        `[MCP] Error executing tool '${toolName}' on '${serverName}':`,
        error.message,
      );
      throw error;
    }
  }

  /** Gracefully close all connected MCP servers. */
  async close(): Promise<void> {
    const names = [...this.clients.keys()];
    if (names.length === 0) return;

    console.log("[MCP] Shutting down MCP servers...");

    await Promise.allSettled(
      names.map(async (name) => {
        try {
          const client = this.clients.get(name);
          const transport = this.transports.get(name);
          if (client) await client.close();
          if (transport) await transport.close();
          console.log(`[MCP] Disconnected '${name}'`);
        } catch {
          // Best-effort — swallow errors during shutdown
        } finally {
          this.clients.delete(name);
          this.transports.delete(name);
        }
      }),
    );

    console.log("[MCP] All MCP servers shut down.");
  }
}

// Export singleton instance
export const mcpManager = new MCPManager(process.cwd());
