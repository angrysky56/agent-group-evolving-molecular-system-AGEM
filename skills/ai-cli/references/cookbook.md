# AI-CLI Cookbook — execution-agnostic recipes

Plain shell pipelines, no executor-specific syntax. Every command follows the
Golden Rules (no color, no pager, structured where possible, preview before
mutate). Scope broad searches to a subdirectory to stay fast.

## Orient in an unfamiliar repo
```bash
tokei --output json                 # languages, file counts, line counts
eza --tree --level=2 --color=never  # top-level structure
fd -t f -e py -a | head -50         # where the code lives (absolute paths)
rg -l 'def main|if __name__' -t py  # likely entry points
```

## Locate → read (surgical)
```bash
# find file + line of a definition as JSON
rg --json 'def train_model' -t py \
  | jq -r 'select(.type=="match") | "\(.data.path.text):\(.data.line_number)"'
# read only the window around it (no pager, no color)
bat --style=numbers --paging=never --color=never -r 120:170 src/trainer.py
```

## Locate → refactor (safe)
```bash
ast-grep -p 'requests.get($URL)' -l python                              # 1. find call sites
ast-grep -p 'requests.get($URL)' -r 'httpx.get($URL)' -l python         # 2. preview diff (no -U)
ast-grep -p 'requests.get($URL)' -r 'httpx.get($URL)' -l python -U      # 3. apply
```

## ripgrep + jq
`rg --json` emits one JSON object per line; useful fields are under `.data`.
```bash
# file paths containing a match, deduplicated
rg --json 'TODO' | jq -r 'select(.type=="match") | .data.path.text' | sort -u
# count matches per file
rg --json 'import' | jq -r 'select(.type=="match") | .data.path.text' \
  | sort | uniq -c | sort -rn
```

## Safe find-and-replace
```bash
sd -p 'old_url' 'new_url' config.py            # preview (writes nothing)
sd 'old_url' 'new_url' config.py               # apply to one file
rg -l 'old_url' src/ | xargs sd 'old_url' 'new_url'   # scope, then apply
```
For code identifiers prefer `ast-grep` — `sd` matches text and clobbers
substrings (`user` inside `username`).

## Config drilling (yq)
```bash
yq '.tool.ruff.line-length' pyproject.toml
yq -o=json '.' config.yaml | jq '.services | keys'
```
