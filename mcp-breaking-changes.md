Viewed package.json:1-156

The issue is **in the Python packages published on PyPI**, not in AGEM's code or AGEM's Node.js `@modelcontextprotocol/sdk`.

---

### What Changed Upstream

1. **`uvx` Ephemeral Environments**:
   When `mcp.json` executes commands like `uvx mcp-server-sqlite` or `uvx mcp-server-fetch`, `uvx` creates a fresh, isolated Python virtualenv on the fly and downloads the latest package versions from PyPI.

2. **Breaking Release of the `mcp` Python Library**:
   The official Python `mcp` SDK published a major update on PyPI that refactored internal classes and exception names (e.g. `McpError` → `MCPError`, and changes to `Server` methods like `list_resources` and `list_prompts`).

3. **Uncapped Dependencies on PyPI**:
   The authors of `mcp-server-sqlite`, `docker-mcp`, and `mcp-server-fetch` wrote their `pyproject.toml` specs with unpinned dependencies (e.g. `mcp >= 1.0.0` with no upper limit). When `uvx` built the virtualenv today, PyPI handed it the brand new, breaking `mcp` Python SDK.

---

### Why `--with "mcp<1.2.0"` Fixes It

You normally wouldn't need version flags in `mcp.json` if package authors capped their dependencies upstream.

Adding `--with "mcp<1.2.0"` tells `uvx`'s dependency resolver:

> _"When building the isolated environment for this tool, pin the Python `mcp` package to `<1.2.0` instead of pulling the latest breaking release."_
