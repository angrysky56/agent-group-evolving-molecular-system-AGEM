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
