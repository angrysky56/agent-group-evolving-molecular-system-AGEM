# Configuration Guide

> [!TIP]
> **TL;DR**: AGEM uses `.env` for environment variables and `mcp.json` for external service integration. Key settings include LLM provider selection and local/cloud API URLs.

## Quick-Start Card

| Concern | File | Key Variables |
| :--- | :--- | :--- |
| **LLM Access** | `.env` | `LLM_PROVIDER`, `API_KEY`, `MODEL` |
| **MCP Services** | `mcp.json` | Server paths, args, env |
| **Port Mapping** | `.env` | `PORT` (Default: 8000) |
| **Embeddings** | `.env` | `EMBEDDING_MODEL`, `OLLAMA_BASE_URL` |
| **Finding Memory** | `.env` | `FINDING_RECALL_SIMILARITY_FLOOR`, `FINDING_RECALL_TOP_K` |

## Environment Variables (`.env`)

Copy `.env.example` to `.env` before starting the system.

### LLM Providers
- **Ollama**: `LLM_PROVIDER=ollama`
- **OpenRouter**: `LLM_PROVIDER=openrouter`
- **Anthropic**: `LLM_PROVIDER=anthropic`

### Local Embedding Setup
If using Ollama for embeddings:
```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

### Automatic Finding Memory

```env
# Raw cosine floor first, then top-k. Unrelated material recalls nothing.
FINDING_RECALL_SIMILARITY_FLOOR=0.4
FINDING_RECALL_TOP_K=3

# Never-recalled, never-cited findings sink to an append-only archive.
FINDING_UNUSED_RETENTION_DAYS=180
FINDING_MAX_ACTIVE=500

# Optional typed-claim payload. Retrieval still uses only the verbatim verdict.
FINDING_DENSIFICATION_ENABLED=true
FINDING_DENSIFICATION_TARGET_RATIO=0.28
FINDING_DENSIFICATION_MAX_PASSES=3
FINDING_DENSIFICATION_MAX_SOURCE_TOKENS=8192
FINDING_DENSIFICATION_MAX_OUTPUT_TOKENS=2048
FINDING_DENSIFICATION_MIN_NARRATIVE_TOKENS=16
```

Recall settings affect associative lookup only. Conflict candidates do not use
embedding thresholds: they require exact overlap between schema-validated typed
claims and opposite conclusive outcomes. Densification is attempted only when
the typed path supplies the original corpus plus every supporting claim's
source sentence and required role signature; a failed pass stores no payload
and does not block the finding.
The ratio is never relaxed to make the schema fit. An irreducible envelope is
reported as `budget-too-small` with zero provider calls; repeated invalid or
trivial candidates terminate at `FINDING_DENSIFICATION_MAX_PASSES` as
`fidelity-rejected`.

## MCP Configuration (`mcp.json`)

The `mcp.json` file in the root directory defines all external services AGEM can access.

```json
{
  "mcpServers": {
    "sheaf-consistency-enforcer": {
      "command": "node",
      "args": ["/absolute/path/to/server/dist/index.js"]
    }
  }
}
```

> [!IMPORTANT]
> Ensure all paths in `mcp.json` are **absolute paths**.

## System Defaults

| Param | Default | Meaning |
| :--- | :--- | :--- |
| `iteration` | 1 | Starting iteration for AGEM cycles |
| `regime` | stable | Starting innovative regime |
| `CDP_target` | 0.85 | Target criticality threshold |
