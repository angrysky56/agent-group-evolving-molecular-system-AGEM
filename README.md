# Agent Group Evolving Molecular System (AGEM)

RLM-LCM Molecular-CoT Group Evolving Agents — Sheaf-theoretic multi-agent coordination with a full-stack chat interface.

See [RLM-LCM-Molecular-CoT-Group-Evolving-Agents.md](docs/RLM-LCM-Molecular-CoT-Group-Evolving-Agents.md) for the original project specification and technical deep-dive.

AGEM is a sophisticated multi-agent orchestration framework designed to simulate and manage group-evolving agent behaviors using molecular biological metaphors and advanced mathematical structures. It leverages cellular sheaves for agent stalk tracking and cohomology for structural obstruction detection.

## Key Features

- **Sheaf-Theoretic Coordination**: Uses `CellularSheaf` to track agent states and restriction maps, enabling robust multi-agent consensus.
- **Topological Obstruction Detection**: Employs `CohomologyAnalyzer` to identify structural gaps (H^1) in agent communication and knowledge.
- **Text Network Analysis (TNA)**: Advanced semantic graph processing including community detection (Louvain), centrality analysis, and structural gap detection.
- **Lifecycle Context Model (LCM)**: Efficient context management with embedding-based search and caching using `huggingface/transformers`.
- **Self-Organized Criticality (SOC)**: Real-time tracking of system criticality (CDP, VNE, EE, SER) to manage phase transitions and regime shifts.
- **Molecular Hysteresis**: Obstruction handling inspired by molecular biology (Van der Waals forces, hydrophobic collapses) to manage agent spawning and group stabilization.
- **Full-Stack Chat Interface**: React + Express interface with SSE streaming, session history, knowledge base persistence, and interactive settings.
- **Interactive CLI**: Commander.js-based terminal REPL for quick chat interactions and system management.
- **Dual LLM Provider Support**: Seamless switching between Ollama (local) and OpenRouter (cloud) with provider-specific configuration.
- **Agent Skills System**: YAML-frontmatter based dynamic skill definition loaded natively into the prompt.
- **Model Context Protocol (MCP)**: Native integration with MCP servers to equip agents with dynamic tools. See [system_use.md](system_use.md) for a full list of available tools.

## Tech Stack

### Core Engine

- **Language**: [TypeScript](https://www.typescriptlang.org/) (ES2022)
- **Runtime**: [Node.js](https://nodejs.org/) v20+
- **Mathematics**: [mathjs](https://mathjs.org/), [ml-matrix](https://github.com/mljs/matrix)
- **NLP**: [natural](https://github.com/NaturalNode/natural), [wink-lemmatizer](https://winkjs.org/), [stopword](https://github.com/fergiemcdowall/stopword)
- **Graph Theory**: [graphology](https://graphology.github.io/) (Louvain, Metrics, Layout)
- **AI/ML**: [@huggingface/transformers](https://huggingface.co/docs/transformers.js/)
- **Testing**: [Vitest](https://vitest.dev/)

### Interface

- **Backend**: [Express](https://expressjs.com/) + SSE streaming
- **Frontend**: [React](https://react.dev/) + [Vite](https://vite.dev/) + TypeScript
- **State**: [Zustand](https://zustand.docs.pmnd.rs/) (persisted to localStorage)
- **LLM Providers**: Ollama (local), OpenRouter (cloud)

## Project Structure

```
agent-group-evolving-molecular-system-AGEM/
├── src/                      # Core AGEM engine
│   ├── orchestrator/         # Central coordination + obstruction handling
│   ├── sheaf/                # CellularSheaf + CohomologyAnalyzer
│   ├── tna/                  # Text Network Analysis pipeline
│   ├── soc/                  # Self-Organized Criticality tracker
│   └── lcm/                  # Lifecycle Context Model
├── interface/                # Full-stack chat interface
│   ├── backend/              # Express API + SSE streaming
│   │   └── src/
│   │       ├── server.ts     # Express app, CORS, lifecycle
│   │       ├── config.ts     # Zod-validated settings
│   │       ├── routes/       # chat, sessions, system, knowledge
│   │       └── services/     # llm, agem-bridge, session-store, knowledge-base
│   ├── frontend/             # React + Vite + TypeScript
│   │   └── src/
│   │       ├── App.tsx       # Root layout
│   │       ├── api.ts        # Typed REST + SSE client
│   │       ├── stores/       # Zustand (chat, sessions, settings)
│   │       └── components/   # chat/, sidebar/, settings/
│   └── shared/               # Shared TypeScript types (FE ↔ BE contract)
│       └── types.ts
├── cli/                  # Interactive terminal REPL
│   └── src/
│       └── index.ts      # Commander.js CLI entry point
├── knowledge_base/           # Persistent outputs (reports, analysis)
├── .env.example              # Environment configuration template
└── .env                      # Local config (git-ignored)
```

## Getting Started

### 1. Clone & Install

```bash
git clone https://github.com/angrysky56/agent-group-evolving-molecular-system-AGEM.git
cd agent-group-evolving-molecular-system-AGEM
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env — set LLM_PROVIDER, API keys, model names
```

### 3. Run the Core Engine Tests

```bash
npm test
```

### 4. Start the Interface

```bash
./start.sh
```

This installs dependencies (if needed), copies `.env.example` → `.env` (if missing), and starts both servers. The frontend will be available at `http://localhost:5173` with API proxy to the backend on port 8000. Press `Ctrl+C` to stop both.

```bash
# Or start individually:
./start.sh --backend    # Backend only
./start.sh --frontend   # Frontend only
./start.sh --install    # Force reinstall dependencies
```

## Configuration

All configuration lives in `.env` at the project root. Key settings:

| Variable              | Default                           | Description                                |
| --------------------- | --------------------------------- | ------------------------------------------ |
| `LLM_PROVIDER`        | `ollama`                          | Active provider (`ollama` or `openrouter`) |
| `OLLAMA_BASE_URL`     | `http://localhost:11434`          | Ollama API endpoint                        |
| `OLLAMA_MODEL`        | `gemma3:latest`                   | Ollama chat model                          |
| `OPENROUTER_API_KEY`  | —                                 | OpenRouter API key                         |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1`    | OpenRouter API endpoint                    |
| `OPENROUTER_MODEL`    | `google/gemini-2.5-flash-preview` | OpenRouter chat model                      |
| `PORT`                | `8000`                            | Backend server port                        |

## Architecture

### Core Engine Modules

#### `src/orchestrator`

The central nervous system of AGEM. Coordinates sub-systems and manages the high-level request lifecycle.

- **ComposeRootModule**: Entry point for assembling the AGEM orchestrator.
- **ObstructionHandler**: Manages system state transitions and triggers curative agents.
- **VdWAgentSpawner**: Handles agent creation during system obstructions.

#### `src/sheaf`

Implements the topological backbone of the system.

- **CellularSheaf**: Tracks agent stalks and their relations.
- **CohomologyAnalyzer**: Computes H^0 (consensus) and H^1 (obstructions).

#### `src/tna`

Text Network Analysis pipeline for semantic understanding.

- **GapDetector**: Identifies structural holes in the semantic network.
- **LouvainDetector**: Partitions the semantic graph into communities.
- **CentralityAnalyzer**: Identifies bridge nodes and hubs.

#### `src/soc`

Tracks Self-Organized Criticality metrics to maintain system stability.

- **SOCTracker**: Computes Divergence, Entropy, and Efficiency metrics.

#### `src/lcm`

Lifecycle Context Model for persistent memory.

- **LCMClient**: Handles context appends and similarity search.

### Interface & CLI

The interface wraps the AGEM engine with a chat-like experience:

- **Backend** serves a REST + SSE API on port 8000. Chat completions stream tokens via Server-Sent Events. Sessions persist as JSON files.
- **Frontend** is a React SPA with a dark glassmorphism theme. It uses Zustand for state management and a typed fetch-based API client with SSE streaming support.
- **CLI** provides a fully interactive terminal REPL for quick querying, testing, and managing the server.
- **Agent Skills** system traverses the `skills/` directory, extracts context from YAML frontmatter in `.md` files, and exposes them as selectable knowledge areas to the agent.
- **MCP Integration** intelligently connects to configured external Model Context Protocol servers to dynamically register external tools that the LLM agent can call natively.
- **Shared types** in `interface/shared/types.ts` ensure type safety across the full stack.

## Available Scripts

| Command              | Description                                    |
| -------------------- | ---------------------------------------------- |
| `npm run build`      | Compiles the TypeScript project (core engine). |
| `npm test`           | Runs the full Vitest suite.                    |
| `npm run test:watch` | Runs Vitest in watch mode.                     |
| `npm run typecheck`  | Runs the TypeScript compiler in no-emit mode.  |

## License

MIT (or check `LICENSE` file if present)
