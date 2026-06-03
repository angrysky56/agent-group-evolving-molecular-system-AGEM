# Installation — cross-platform

All tools are available through multiple managers. **`cargo` is the most
portable** (same binary names everywhere, no distro renames) if a Rust
toolchain is present. `jq`/`yq` aren't Rust crates — see their rows.

## ⚠️ Debian/Ubuntu rename trap

Via `apt`, two binaries get non-standard names that break every recipe:

| Upstream name | apt package | apt binary |
|---|---|---|
| `fd`  | `fd-find` | `fdfind` |
| `bat` | `bat`     | `batcat` |

Fix by installing via `cargo` instead, or add shims:
```bash
mkdir -p ~/.local/bin
ln -sf "$(command -v fdfind)" ~/.local/bin/fd
ln -sf "$(command -v batcat)" ~/.local/bin/bat
```

## Per-tool matrix

| Tool | cargo | apt (Debian) | dnf (Fedora) | brew (macOS) | scoop (Win) |
|------|-------|--------------|--------------|--------------|-------------|
| fd | `fd-find` | `fd-find`¹ | `fd-find` | `fd` | `fd` |
| ripgrep | `ripgrep` | `ripgrep` | `ripgrep` | `ripgrep` | `ripgrep` |
| ast-grep | `ast-grep --locked` | — | — | `ast-grep` | `main/ast-grep` |
| bat | `bat` | `bat`¹ | `bat` | `bat` | `bat` |
| sd | `sd` | `sd` | `sd` | `sd` | `sd` |
| jq | — | `jq` | `jq` | `jq` | `jq` |
| yq | — | — | — | `yq` | `yq` |
| tokei | `tokei` | `tokei` | `tokei` | `tokei` | `tokei` |
| eza | `eza` | `eza` | `eza` | `eza` | `eza` |
| dust | `du-dust` | — | — | `dust` | `dust` |
| procs | `procs` | `procs` | — | `procs` | `procs` |
| delta | `git-delta` | `git-delta` | `git-delta` | `git-delta` | `delta` |
| hyperfine | `hyperfine` | `hyperfine` | `hyperfine` | `hyperfine` | `hyperfine` |
| just | `just` | `just` | `just` | `just` | `just` |

¹ apt renames these — see the trap above.

Other universal routes: `ast-grep` via `pip install ast-grep-cli` or
`npm i -g @ast-grep/cli`; `yq` via `uv tool install yq` (Python, wraps jq) or
`snap install yq` (Go build).

## One-shot bootstrap (cargo route, no sudo)

```bash
#!/usr/bin/env bash
set -euo pipefail
cargo install fd-find ripgrep ast-grep --locked
cargo install bat sd tokei eza du-dust procs git-delta hyperfine just
# non-Rust: jq via your OS package manager; yq via `uv tool install yq`
echo "done — run scripts/check_tools.sh to verify"
```

## Verifying

```bash
bash scripts/check_tools.sh
```
Prints each tool as OK/MISSING with an install hint. Idempotent.
