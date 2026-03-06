# Agent Group Evolving Molecular System (AGEM)

RLM-LCM Molecular-CoT Group Evolving Agents (AGEM) - Sheaf-theoretic multi-agent coordination.

See [RLM-LCM-Molecular-CoT-Group-Evolving-Agents.md](docs/RLM-LCM-Molecular-CoT-Group-Evolving-Agents.md) for the original project specification and technical deep-dive.

AGEM is a sophisticated multi-agent orchestration framework designed to simulate and manage group-evolving agent behaviors using molecular biological metaphors and advanced mathematical structures. It leverages cellular sheaves for agent stalk tracking and cohomology for structural obstruction detection.

## Key Features

- **Sheaf-Theoretic Coordination**: Uses `CellularSheaf` to track agent states and restriction maps, enabling robust multi-agent consensus.
- **Topological Obstruction Detection**: Employs `CohomologyAnalyzer` to identify structural gaps (H^1) in agent communication and knowledge.
- **Text Network Analysis (TNA)**: Advanced semantic graph processing including community detection (Louvain), centrality analysis, and structural gap detection.
- **Lifecycle Context Model (LCM)**: Efficient context management with embedding-based search and caching using `huggingface/transformers`.
- **Self-Organized Criticality (SOC)**: Real-time tracking of system criticality (CDP, VNE, EE, SER) to manage phase transitions and regime shifts.
- **Molecular Hysteresis**: Obstruction handling inspired by molecular biology (Van der Waals forces, hydrophobic collapses) to manage agent spawning and group stabilization.

## Tech Stack

- **Core**: [TypeScript](https://www.typescriptlang.org/) (ES2022)
- **Runtime**: [Node.js](https://nodejs.org/)
- **Mathematics**: [mathjs](https://mathjs.org/), [ml-matrix](https://github.com/mljs/matrix)
- **Natural Language Processing**: [natural](https://github.com/NaturalNode/natural), [wink-lemmatizer](https://winkjs.org/), [stopword](https://github.com/fergiemcdowall/stopword)
- **Graph Theory**: [graphology](https://graphology.github.io/) (Louvain, Metrics, Layout)
- **AI/ML**: [@huggingface/transformers](https://huggingface.co/docs/transformers.js/)
- **Testing**: [Vitest](https://vitest.dev/)

## Prerequisites

- **Node.js**: v20 or higher
- **npm**: (Included with Node.js)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/angrysky56/agent-group-evolving-molecular-system-AGEM.git
cd agent-group-evolving-molecular-system-AGEM
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run Tests

Ensure everything is working correctly by running the suite:

```bash
npm test
```

## Architecture

The project is organized into several core modules:

### `src/orchestrator`
The central nervous system of AGEM. It coordinates sub-systems and manages the high-level request lifecycle.
- **ComposeRootModule**: The entry point for assembling the AGEM orchestrator.
- **ObstructionHandler**: Manages system state transitions and triggers curative agents.
- **VdWAgentSpawner**: Handles agent creation during system obstructions.

### `src/sheaf`
Implements the topological backbone of the system.
- **CellularSheaf**: Tracks agent stalks and their relations.
- **CohomologyAnalyzer**: Computes H^0 (consensus) and H^1 (obstructions).

### `src/tna`
Text Network Analysis pipeline for semantic understanding.
- **GapDetector**: Identifies structural holes in the semantic network.
- **LouvainDetector**: Partitions the semantic graph into communities.
- **CentralityAnalyzer**: Identifies bridge nodes and hubs.

### `src/soc`
Tracks Self-Organized Criticality metrics to maintain system stability.
- **SOCTracker**: Computes Divergence, Entropy, and Efficiency metrics.

### `src/lcm`
Lifecycle Context Model for persistent memory.
- **LCMClient**: Handles context appends and similarity search.

## Available Scripts

| Command | Description |
|---|---|
| `npm run build` | Compiles the TypeScript project. |
| `npm test` | Runs the full Vitest suite. |
| `npm run test:watch` | Runs Vitest in watch mode. |
| `npm run typecheck` | Runs the TypeScript compiler in no-emit mode. |

## License

MIT (or check `LICENSE` file if present)
