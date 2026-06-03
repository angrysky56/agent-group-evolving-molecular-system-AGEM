# AI-CLI

A general, **execution-agnostic** agent skill for using modern, token-efficient
command-line tools (`fd`, `rg`, `ast-grep`, `bat`, `sd`, `jq`, `yq`, `tokei`,
`eza`, `dust`, `procs`, `delta`, `hyperfine`, `just`) in place of legacy
coreutils (`find`, `grep`, `cat`, `sed`, `ls`, `du`, `ps`).

It teaches an agent *which tool to reach for*, *what flags produce
agent-friendly output*, and *how to stay portable* — independent of how shell
commands are executed (a terminal, Claude Code's bash tool, Desktop Commander,
or any MCP shell bridge) and across Linux, macOS, and Windows.

## Layout
```
AI-CLI/
├── SKILL.md                     # principles, task→tool map, per-tool invocations
├── references/
│   ├── installation.md          # cross-platform install matrix + rename trap
│   ├── cross-platform.md        # OS/shell differences agents trip on
│   └── cookbook.md              # execution-agnostic combined pipelines
└── scripts/
    └── check_tools.sh           # OK/MISSING report with install hints
```

## Quick start
```bash
bash scripts/check_tools.sh      # see what's installed
```

## Install as a live skill (Claude Code / Cowork)
Symlink it into your skills directory so edits here stay in sync:
```bash
ln -sfn "$(pwd)" ~/.claude/skills/ai-cli
```

## Relationship to `local-repl-cli`
This skill is the **general** version. A sibling skill, `local-repl-cli` (in
the `local-repl-mcp` project), specializes the same tool knowledge for the
**LocalREPL MCP shell bridge** — adding that environment's structured
`run_shell` output, operational-memory logging, and MCP-subprocess gotchas.
Use this one for portable, executor-independent guidance; consult
`local-repl-cli` when commands run specifically through LocalREPL.
