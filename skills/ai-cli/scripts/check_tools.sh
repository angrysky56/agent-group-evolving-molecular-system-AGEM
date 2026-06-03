#!/usr/bin/env bash
# check_tools.sh — report which modern CLI tools are installed.
# No-color, machine-readable, idempotent. POSIX bash.
# On Windows: run under WSL or Git Bash, or port the loop to PowerShell.
set -uo pipefail

# command | purpose | install hint (cross-platform; see references/installation.md)
TOOLS=(
  "rg|content search (grep)|cargo install ripgrep | brew install ripgrep"
  "fd|file discovery (find)|cargo install fd-find | brew install fd"
  "ast-grep|structural search/rewrite|cargo install ast-grep --locked | brew install ast-grep"
  "bat|surgical file read (cat)|cargo install bat | brew install bat"
  "sd|find & replace (sed)|cargo install sd | brew install sd"
  "jq|JSON processor|apt/brew/scoop install jq"
  "yq|YAML/TOML processor|uv tool install yq | brew install yq"
  "tokei|code statistics|cargo install tokei | brew install tokei"
  "eza|directory listing (ls)|cargo install eza | brew install eza"
  "dust|disk usage (du)|cargo install du-dust | brew install dust"
  "procs|process inspection (ps)|cargo install procs | brew install procs"
  "delta|git diff viewer|cargo install git-delta | brew install git-delta"
  "hyperfine|benchmarking (time)|cargo install hyperfine | brew install hyperfine"
  "just|task runner (make)|cargo install just | brew install just"
)

present=0; missing=0; missing_list=""
for row in "${TOOLS[@]}"; do
  cmd="${row%%|*}"; rest="${row#*|}"
  purpose="${rest%%|*}"; hint="${rest#*|}"
  if command -v "$cmd" >/dev/null 2>&1; then
    printf 'OK    %-10s %s\n' "$cmd" "$purpose"
    present=$((present + 1))
  else
    printf 'MISS  %-10s %s  ->  %s\n' "$cmd" "$purpose" "$hint"
    missing=$((missing + 1)); missing_list="${missing_list} ${cmd}"
  fi
done

printf '\n--- summary: %d present, %d missing ---\n' "$present" "$missing"
[ "$missing" -gt 0 ] && printf 'missing:%s\nsee references/installation.md\n' "$missing_list"
exit 0  # report, not a gate
