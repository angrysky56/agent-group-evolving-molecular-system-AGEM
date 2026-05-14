# Testing Guide

> [!TIP]
> **TL;DR**: AGEM uses **Vitest** for all testing. Tests are colocated with source code and focus on mathematical verification, module isolation, and event propagation.

## Quick-Start Card

| Target | Scope | Command |
| :--- | :--- | :--- |
| **Full Suite** | All unit/integration | `npm test` |
| **Watch Mode** | Live development | `npm run test:watch` |
| **Specific File**| Single component | `npx vitest path/to/file.test.ts` |
| **Coverage** | Code coverage report | `npx vitest run --coverage` |
| **Isolation** | Verify no cross-imports | `npm run test:isolation` (via vitest) |

## Test Categories

### 1. Unit Tests (Mathematical Properties)
Found in `src/**/*.test.ts`. These verify:
- **Sheaf**: Coboundary matrix assembly, SVD accuracy.
- **SOC**: VNE calculation, entropy limits.
- **LCM**: Embedding similarity, escalation triggers.

### 2. Integration Tests (Event Propagation)
Found in `src/orchestrator/__tests__`. These verify that events (e.g., `H1_OBSTRUCTION`) correctly trigger downstream actions (e.g., `SpawnAgent`).

### 3. Module Isolation Tests
Located in each module's directory. These use custom scripts to ensure that `src/sheaf` never imports from `src/lcm`, etc.

## Mocking Policy

We use a "Mock-by-Default" policy for expensive operations:
- **LLM**: All LLM calls in unit tests are mocked via `ProviderFactory`.
- **Embeddings**: Uses a deterministic hash-based mock embedder to avoid network calls.

## Running Tests

```bash
# Standard run
npm test

# Run with UI
npx vitest --ui
```
