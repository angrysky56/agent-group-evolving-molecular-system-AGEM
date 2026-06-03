---
name: ai-cli
description: >-
  Use modern, token-efficient command-line tools (fd, ripgrep, ast-grep, bat,
  sd, jq, yq, tokei, eza, dust, procs, delta, hyperfine, just) instead of
  legacy coreutils (find, grep, cat, sed, ls, du, ps) for any shell, file, or
  codebase task — on any platform (Linux/macOS/Windows) and through any
  executor (a terminal, Claude Code's bash tool, Desktop Commander, or an MCP
  shell bridge). Trigger whenever you are about to search files, grep for text,
  read or inspect files, find-and-replace, refactor code, traverse a
  repository, process JSON/YAML, or inspect disk usage or processes — even if
  the user did not name a specific tool. These tools are faster,
  .gitignore-aware, and emit clean structured output that protects the context
  window. For installation across operating systems and platform-specific
  quirks, see references/. If you run commands specifically through the
  LocalREPL MCP bridge, also consult the local-repl-cli skill for
  environment-specific gotchas.
---

# AI-CLI — Modern Command-Line Tools for Agents

Legacy GNU coreutils (`find`, `grep`, `cat`, `sed`, `ls`) were designed for a
human at a terminal. They are slow, awkward to compose, and emit output hostile
to a language model's context window. This skill maps common shell tasks onto
fast, structured-output replacements and defines the invocation rules that keep
them predictable for an agent.

**This skill is execution-agnostic.** The rules below hold whether you run
commands in a plain terminal, via Claude Code's bash tool, via Desktop
Commander, or through an MCP shell bridge. What *does* change between
environments — `$PATH` inheritance, which shell `/bin/sh` points to, pager
behavior, GNU-vs-BSD flag differences — is covered in
`references/cross-platform.md`. Read it before debugging anything that "works
in my terminal but not here."

## Why this matters for an agent

Three failure modes to design against:

1. **Context blowout** — `cat`-ing a 10,000-line file dumps the whole thing
   into context. Read surgically instead.
2. **Recursion noise & loops** — `find` descends into `node_modules/`, `.git/`,
   `.venv/`, producing thousands of irrelevant paths. The modern tools respect
   `.gitignore` and skip hidden dirs by default.
3. **Tokenization corruption** — ANSI color codes shatter clean tokenization.
   Strip them on every call.

## The Golden Rules (every invocation, every platform)

1. **No color.** Always `--color=never` / `--no-color`. Color escapes corrupt
   tokenization and carry no information for an agent.
2. **No pagers, no TUIs.** `bat` (and `delta`, `git`) hang waiting on an
   interactive pager. Always `--paging=never`. Never invoke interactive modes
   (`-i`, `fzf`, `zoxide`'s `zi`) — there is no human at the keyboard.
3. **Read surgically.** Never dump a whole file. Search first, then read a line
   range around the hit (`bat -r 50:120`).
4. **Prefer structured output.** Use `--json` (ripgrep, ast-grep) and pipe to
   `jq`/`yq`. Parse data structures; don't regex over prose.
5. **Stay deterministic and safe.** Preview any file mutation before applying
   (`sd -p`, ast-grep without `--update-all`). When chaining steps in bash, use
   `set -euo pipefail` — but see cross-platform.md, since `/bin/sh` may be dash,
   not bash.
6. **Emit absolute paths.** Prefer absolute paths (`fd -a`) so a later step
   never depends on the current working directory.

## Task → Tool quick map

| Goal | Tool | Replaces | Canonical agent one-liner |
|------|------|----------|---------------------------|
| Find files by name/type | `fd` | `find` | `fd -a --color=never -e py pattern` |
| Search file *contents* | `rg` (ripgrep) | `grep` | `rg --json 'pattern'` |
| Search/rewrite by code *structure* | `ast-grep` | `grep`+`sed` | `ast-grep -p 'pat' -l python` |
| Read part of a file | `bat` | `cat` | `bat --style=plain --paging=never -r 40:80 f` |
| Find & replace text | `sd` | `sed` | `sd -p 'before' 'after' file` |
| Process JSON | `jq` | — | `rg --json x \| jq -r '.data.path.text'` |
| Process YAML/TOML | `yq` | — | `yq '.key' f.yaml` |
| Size up a codebase | `tokei` | `wc`/`cloc` | `tokei --output json` |
| List a directory tree | `eza` | `ls`/`tree` | `eza --tree --level=2 --color=never` |
| Disk usage | `dust` | `du` | `dust -d 1` |
| Inspect processes | `procs` | `ps` | `procs --no-color` |
| Read a git diff | `delta` | `git diff` pager | `git diff \| delta --no-gitconfig` |
| Run project tasks | `just` | `make` | `just <recipe>` |
| Benchmark a command | `hyperfine` | `time` | `hyperfine --warmup 3 'cmd'` |

## Choosing your search tool: fd vs rg vs ast-grep

- **`fd`** — you know something about the *filename, path, or type*
  ("find all `test_*.py`").
- **`rg`** — you want *text/content* anywhere, as a fast first pass. Use `-l`
  to get just filenames to feed the next step.
- **`ast-grep`** — you care about *code structure*, not text (refactors;
  "find every call to `foo()` regardless of whitespace, comments, or
  wrapping"). Regex can't see that `foo(\n a,\n b)` equals `foo(a, b)`;
  ast-grep can — and it won't clobber a substring inside another name.

**Rule of thumb:** locate with `rg`/`fd`, transform with `ast-grep`/`sd`.

## Core tools (agent-optimized invocations)

### fd — file discovery (replaces `find`)
`.gitignore`- and hidden-aware by default; `-H` includes hidden, `-I` ignores
ignore-files (needed when cleaning gitignored cache dirs). Smart-case.
- `fd -a -e py 'test_'` — absolute paths, Python files matching `test_`
- `fd -t d -a '__pycache__'` — directories only
- `fd -e json -x jq '.version' {}` — run a command per match (parallel)

### ripgrep (rg) — content search (replaces `grep`)
- `rg --color=never 'TODO'` — basic recursive search
- `rg --json 'fn main'` — structured records; pipe to `jq`
- `rg -l 'import torch'` — files-with-matches only; feed to the next tool
- `rg -t py -C 3 'def train'` — Python only, 3 lines of context
- `rg -F 'literal[brackets]'` — fixed-string mode

### ast-grep — structural search & rewrite (replaces `grep`+`sed` for code)
- ⚠️ **On Linux the command is `ast-grep`, not `sg`** (`sg` is `setgroups`).
- search: `ast-grep -p 'console.log($A)' -l js`
- rewrite (preview): `ast-grep -p 'console.log($A)' -r 'logger.info($A)' -l js`
- apply: add `-U` / `--update-all` — **preview first**, then re-run with `-U`.
- metavariables: `$VAR` = one node; `$$$ARGS` = a sequence. (`$$$` binds arg
  lists, not function bodies — `def $NAME($$$): $$$` matches nothing.)

### bat — surgical file reading (replaces `cat`)
- ⚠️ Always `--paging=never` or it hangs on a pager.
- `bat --style=plain --paging=never --color=never -r 50:120 file.py`
- use `--style=numbers` when you need line numbers to plan an edit.

### sd / jq / yq — replace & structured data
- `sd -p 'foo' 'bar' file` — **preview** find/replace; drop `-p` to apply.
  For code *identifiers* use ast-grep instead (sd clobbers substrings).
- `jq -r '.items[].name' f.json` — raw strings out; `jq -c` for compact.
- `yq '.tools.python' pyproject.toml` — yq handles YAML/TOML/JSON/XML.

## Extended tools

- **tokei** — `tokei --output json` for languages/files/lines. First move when
  sizing an unfamiliar repo.
- **eza** — directory listing; the maintained successor to `exa` (which is
  abandoned — don't use `exa`). `eza --tree --level=2 --color=never`.
- **dust** — `dust -d 1` shows what's eating disk (replaces `du`).
- **procs** — `procs --no-color python` (replaces `ps`).
- **delta** — a viewer for git/unified diffs; pipe `git diff` through it.
- **hyperfine** — `hyperfine --warmup 3 'a' 'b'` for rigorous benchmarking.
- **just** — a command runner (replaces `make`); `just --list`, `just <recipe>`.

## Installation & cross-platform

- `references/installation.md` — install matrix across Linux package managers,
  macOS (Homebrew), Windows (scoop/winget), and the universal `cargo`/`npm`/
  `pip` routes; includes the Debian `fd`→`fdfind` / `bat`→`batcat` rename trap.
- `references/cross-platform.md` — OS and shell differences agents trip on:
  GNU vs BSD/macOS flags, the `sg`/setgroups clash, `$PATH` inheritance in
  spawned subprocesses, `/bin/sh`-is-dash, and Windows/WSL/PowerShell notes.
- `references/cookbook.md` — execution-agnostic combined pipelines
  (orient-in-a-repo, locate→read, safe refactor, rg→jq).
- `scripts/check_tools.sh` — POSIX self-check (OK/MISSING + install hints). On
  Windows run it under WSL or Git Bash, or port the loop to PowerShell.

## When to use this skill

Trigger when the task involves searching, inspecting, counting, comparing,
refactoring, or traversing files/code, or extracting fields from JSON/YAML —
even when no specific tool is named. Do NOT trigger for pure in-language work
(writing a Python function), single-file edits handled by an edit tool, or
questions that don't touch the filesystem.

## Running through a specific executor

The tool knowledge here is identical regardless of how shell runs. Only the
wrapper differs: Claude Code's bash tool and Desktop Commander's process tools
work directly. If you run commands through the **LocalREPL MCP bridge**, also
read the `local-repl-cli` skill — it documents that environment's specific
gotchas (structured `run_shell` output, `/bin/sh` not bash, PATH inheritance,
ripgrep's stdin-hang, and operational-memory logging).
