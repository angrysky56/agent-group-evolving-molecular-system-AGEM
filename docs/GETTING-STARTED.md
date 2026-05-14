# Getting Started with AGEM

> [!TIP]
> **TL;DR**: AGEM requires a local LLM (Ollama) or API keys (OpenRouter/Anthropic) and the EFHF MCP server suite. Use `./start.sh` to launch the full environment.

## Quick-Start Card

| Step | Action | Command |
| :--- | :--- | :--- |
| **1. Install** | Clone & npm install | `npm install` |
| **2. EFHF Suite**| Clone MCP servers | `git clone ...` |
| **3. Configure** | Set `.env` and `mcp.json` | `cp .env.example .env` |
| **4. Launch** | Start UI & Backend | `./start.sh` |
| **5. Test** | Run engine validation | `npm test` |

## Prerequisites

1. **Node.js**: v20 or higher.
2. **Local LLM (Recommended)**: [Ollama](https://ollama.com/) with `gemma3` and `nomic-embed-text`.
3. **EFHF MCP Servers**: AGEM depends on the external Emergent Functional Hierarchy Framework servers.

## Installation

```bash
git clone https://github.com/angrysky56/agent-group-evolving-molecular-system-AGEM.git
cd agent-group-evolving-molecular-system-AGEM
npm install
```

## Configuring the EFHF Suite

AGEM's power comes from its coordinated MCP servers. You must clone these into a sibling directory:

```bash
cd ..
git clone https://github.com/angrysky56/sheaf-consistency-enforcer.git
git clone https://github.com/angrysky56/conscience-servitor.git
git clone https://github.com/angrysky56/HiPAI-Montague-Semantic-Cognition.git
# See README for full list of 8+ servers
```

## Running the System

The easiest way to start is the integrated launch script:

```bash
./start.sh
```

- **Frontend**: `http://localhost:5173`
- **Backend**: `http://localhost:8000`
- **Interactive Dashboard**: Use the dashboard on the right panel to monitor H¹ obstructions and SOC metrics in real-time.

## First Interaction

1. Open the Chat UI.
2. Select a **Skill** (e.g., `agem-expert`).
3. Type a complex reasoning prompt.
4. Watch the **System Vitals** update as AGEM spawns exploratory agents to resolve logical gaps.
