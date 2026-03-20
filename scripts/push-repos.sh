#!/usr/bin/env bash
# Review unpushed commits across MUI repos and optionally push them.
#
# Usage:
#   ./scripts/push-repos.sh [--all] [--dry-run] [--diff]
#
# Options:
#   --all       Push all repos with unpushed commits without interactive selection
#   --dry-run   Show what would be pushed without actually pushing
#   --diff      Show the full diff of unpushed commits (implies --dry-run)
#
# Loads repos from ~/mui.code-workspace (requires fzf for interactive mode).
#
# Examples:
#   ./scripts/push-repos.sh
#   ./scripts/push-repos.sh --all
#   ./scripts/push-repos.sh --dry-run
#   ./scripts/push-repos.sh --dry-run --diff

set -euo pipefail

ALL=false
DRY_RUN=false
DIFF=false

for arg in "$@"; do
  if [[ "$arg" == "--all" ]]; then
    ALL=true
  elif [[ "$arg" == "--dry-run" ]]; then
    DRY_RUN=true
  elif [[ "$arg" == "--diff" ]]; then
    DIFF=true
    DRY_RUN=true
  else
    echo "Unknown argument: $arg"
    echo "Usage: $0 [--all] [--dry-run] [--diff]"
    exit 1
  fi
done

WORKSPACE_FILE="$HOME/mui.code-workspace"
if [[ ! -f "$WORKSPACE_FILE" ]]; then
  echo "Error: $WORKSPACE_FILE not found"
  exit 1
fi
if ! command -v jq &>/dev/null; then
  echo "Error: jq is required (brew install jq)"
  exit 1
fi

WORKSPACE_DIR=$(dirname "$WORKSPACE_FILE")

# Build list of repos, excluding tool/design repos
REPO_LIST=$(jq -r '.folders[] | (.name // (.path | split("/") | last)) + "\t" + .path' "$WORKSPACE_FILE")

# Scan each repo for unpushed commits
UNPUSHED_LIST=""
while IFS=$'\t' read -r name rel_path; do
  repo="$WORKSPACE_DIR/$rel_path"
  [[ -d "$repo/.git" ]] || continue

  branch=$(git -C "$repo" symbolic-ref --short HEAD 2>/dev/null) || continue

  # Skip if no tracking branch set
  tracking=$(git -C "$repo" rev-parse --abbrev-ref "@{u}" 2>/dev/null) || continue

  count=$(git -C "$repo" rev-list --count "@{u}..HEAD" 2>/dev/null) || continue
  [[ "$count" -gt 0 ]] || continue

  commits=$(git -C "$repo" log --oneline "@{u}..HEAD" 2>/dev/null)
  summary=$(echo "$commits" | head -3 | sed 's/^/    /')
  [[ "$count" -gt 3 ]] && summary="$summary"$'\n'"    ... ($count total)"

  shortstat=$(git -C "$repo" diff --shortstat "@{u}..HEAD" 2>/dev/null \
    | grep -oE '[0-9]+ insertion|[0-9]+ deletion' \
    | awk '/insertion/{i=$1} /deletion/{d=$1} END {
        if (i && d) printf "+%s/-%s", i, d
        else if (i)  printf "+%s", i
        else if (d)  printf "-%s", d
      }' || true)
  [[ -n "$shortstat" ]] && shortstat=", $shortstat"

  UNPUSHED_LIST+="$name ($branch, $count commit(s)$shortstat)"$'\n'"$summary"$'\n\t'"$rel_path"$'\n'
done <<< "$REPO_LIST"

if [[ -z "$UNPUSHED_LIST" ]]; then
  echo "Nothing to push — all repos are up to date with their tracking branch."
  exit 0
fi

echo "Repos with unpushed commits:"
echo ""

# Display summary
while IFS= read -r line; do
  [[ "$line" == $'\t'* ]] && continue
  echo "  $line"
done <<< "$UNPUSHED_LIST"

echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  if [[ "$DIFF" == "true" ]]; then
    while IFS= read -r line; do
      if [[ "$line" == $'\t'* ]]; then
        rel_path="${line#$'\t'}"
        repo="$WORKSPACE_DIR/$rel_path"
        echo "──────────────────────────────────────────"
        echo "Diff: $current_name"
        echo ""
        git -C "$repo" diff "@{u}..HEAD" --stat
        echo ""
        git -C "$repo" diff "@{u}..HEAD"
        echo ""
      elif [[ -n "$line" && "$line" != "    "* ]]; then
        current_name="${line%% (*}"
      fi
    done <<< "$UNPUSHED_LIST"
  fi
  echo "(dry run — nothing was pushed)"
  exit 0
fi

# Build a clean name<TAB>path list for fzf or --all
FZF_INPUT=""
while IFS= read -r line; do
  if [[ "$line" == $'\t'* ]]; then
    rel_path="${line#$'\t'}"
    FZF_INPUT+="$current_name"$'\t'"$rel_path"$'\n'
  elif [[ -n "$line" && "$line" != "    "* ]]; then
    current_name="${line%% (*}"
  fi
done <<< "$UNPUSHED_LIST"

FZF_INPUT="${FZF_INPUT%$'\n'}"

if [[ "$ALL" == "true" ]]; then
  SELECTED_PATHS=$(echo "$FZF_INPUT" | cut -f2)
else
  if ! command -v fzf &>/dev/null; then
    echo "Error: fzf is required for interactive selection (brew install fzf)"
    echo "Use --all to push everything without selection."
    exit 1
  fi
  SELECTED_PATHS=$(echo "$FZF_INPUT" \
    | fzf --multi \
          --with-nth=1 \
          --delimiter=$'\t' \
          --prompt="Select repos to push (TAB=multi-select, ENTER=confirm): " \
    | cut -f2)
fi

if [[ -z "$SELECTED_PATHS" ]]; then
  echo "No repos selected, exiting."
  exit 0
fi

echo ""
while IFS= read -r rel_path; do
  repo="$WORKSPACE_DIR/$rel_path"
  name=$(basename "$rel_path")
  branch=$(git -C "$repo" symbolic-ref --short HEAD 2>/dev/null)

  echo "──────────────────────────────────────────"
  echo "Pushing: $name ($branch)"
  git -C "$repo" push upstream "$branch"
  echo "  Done."
done <<< "$SELECTED_PATHS"

echo ""
echo "Done."
