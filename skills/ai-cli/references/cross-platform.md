# Cross-platform notes for agents

The modern tools in this skill (`fd`, `rg`, `ast-grep`, `bat`, `sd`, `jq`,
`tokei`, `eza`, `dust`, `procs`, `delta`, `hyperfine`, `just`) behave
**consistently across Linux, macOS, and Windows** — that uniformity is itself a
reason to prefer them over system coreutils, whose flags differ by platform.
The notes below cover where the *environment around* the tools still bites.

## One-shot global no-color

Every tool here honors the `NO_COLOR` environment variable. Set it once and you
don't need per-command `--color=never`:

```bash
export NO_COLOR=1
```

Pair with `export PAGER=cat` (or `git --no-pager …`) to neutralize pagers
globally in a non-interactive session.

## Linux

- **`sg` is taken.** On Linux `sg` is `setgroups`. The AST tool must be invoked
  as `ast-grep`, never `sg`.
- **Debian/Ubuntu rename `fd`→`fdfind`, `bat`→`batcat`** when installed via
  `apt`. Install via `cargo` for canonical names, or symlink. See
  `installation.md`.
- **`/bin/sh` is `dash`,** not bash. No brace expansion `{a,b}`, no `[[ ]]`, no
  `<(...)` process substitution. Use POSIX syntax or `bash -c '…'` explicitly.

## macOS

- **System tools are BSD, not GNU.** If you fall back to `sed`/`find`/`date`,
  flags differ: in-place edit is `sed -i ''` (BSD) vs `sed -i` (GNU). Using
  `sd`/`fd` sidesteps this entirely — another reason to prefer them.
- Install via Homebrew (`brew install …`); all tools are available.
- `/bin/sh` is a POSIX shell; treat it like dash for portability.

## Windows

- Native `cmd`/PowerShell don't ship these tools, and POSIX pipelines differ.
  **Easiest path: run inside WSL2 or Git Bash** and treat it as Linux.
- For native installs use `scoop install <tool>` or `winget`, or the universal
  `cargo`/`npm`/`pip` routes.
- Watch for path separators (`\` vs `/`) and CRLF line endings — `rg`/`fd`
  handle both, but downstream scripts may not. `dos2unix` or `sd '\r' ''` fixes
  line endings.
- `check_tools.sh` is POSIX bash — run it under WSL/Git Bash, or port the loop
  to PowerShell.

## Subprocess PATH (any OS)

A process launched by a GUI app, launchd/systemd service, or an MCP server does
**not** read your `.bashrc`/`.zshrc`, so its `$PATH` is minimal — typically just
`/usr/bin:/bin` plus maybe `~/.local/bin` and `~/.cargo/bin`.

**Symptom:** a tool runs fine in your terminal but the agent's invocation
returns exit code 127 ("not found").

**Fix:** symlink the binary into a directory that *is* on the subprocess PATH
(usually `~/.local/bin`), rather than hardcoding full paths (which break across
version bumps and home moves):

```bash
ln -sf "$(command -v TOOL)" ~/.local/bin/TOOL
```

## Deterministic sorting & encoding

For reproducible byte-wise sorting and to avoid locale surprises across
machines, set `LC_ALL=C` for the command. Relevant when diffing tool output
between platforms.
