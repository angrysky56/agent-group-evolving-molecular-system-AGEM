# Development Guide

> [!TIP]
> **TL;DR**: AGEM uses TypeScript (ES2022). All core modules must be isolated (zero cross-imports). Use `npm test` to verify logic and `npm run typecheck` to verify types.

## Quick-Start Card

| Task | Action | Command |
| :--- | :--- | :--- |
| **Build** | Compile TS | `npm run build` |
| **Test** | Run Vitest suite | `npm test` |
| **New Module** | Create in `src/` | Follow isolation rules |
| **Skill Dev** | Add to `skills/` | Use `skill-architect` |
| **Dashboard** | Edit React FE | `cd interface/frontend` |

## Core Principles

1. **Mathematical Rigor**: All features must map to the project's sheaf-theoretic or information-theoretic foundations.
2. **Zero Cross-Imports**: Modules (`sheaf`, `soc`, `lcm`, `tna`, `lumpability`) must not import from each other. Use the `EventBus` for coordination.
3. **TDD First**: Core logic must be covered by unit tests in the same directory.

## Adding a New Module

If you are adding a new core capability (e.g., `causal-inference`):

1. Create `src/your-module/`.
2. Define a typed interface for your module's events in `src/types/`.
3. Implement your logic with zero imports from other `src/` subdirectories.
4. Wire your module into the orchestrator via `src/orchestrator/ComposeRootModule.ts`.

## Skill Development

Agent personas and domain knowledge are defined as **Skills** in the `skills/` directory.

- Use the `skill-architect` skill for scaffolding.
- Skills must follow the [Agent Skills](file:///home/ty/.gemini/antigravity/global_workflows/agent-skills.md) standard (TL;DR, Quick-Start, Progressive Disclosure).

## CI/CD and Linting

We use **Trunk** and **Vitest** for quality control.

```bash
# Run all linters and tests
trunk check
npm test
```
