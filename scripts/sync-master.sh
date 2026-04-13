#!/usr/bin/env bash
# Switch every repo in the workspace to its default branch and pull latest changes.
#
# Usage:
#   ./scripts/sync-master.sh [<repo-path> ...]
#
# If no repos are specified, an interactive selector loads repos from
# ~/mui.code-workspace (requires fzf).
#
# Repos with unstaged or staged changes are warned and skipped.

set -euo pipefail

TARGETS=()

for arg in "$@"; do
  TARGETS+=("$arg")
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

# If no targets specified, load from workspace and use fzf for selection
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  if ! command -v fzf &>/dev/null; then
    echo "Error: fzf is required for interactive repo selection (brew install fzf)"
    exit 1
  fi

  REPO_LIST=$(jq -r '.folders[] | (.name // (.path | split("/") | last)) + "\t" + .path' "$WORKSPACE_FILE" \
    | grep -v $'\t'"mui-olivier-tools"$ \
    | grep -v $'\t'"mui-design-kits"$)

  SELECTED=$(echo "$REPO_LIST" \
    | fzf --multi \
          --with-nth=1 \
          --delimiter=$'\t' \
          --prompt="Select repos to sync (TAB=multi-select, ENTER=confirm): " \
    | cut -f2)

  if [[ -z "$SELECTED" ]]; then
    echo "No repos selected, exiting."
    exit 0
  fi

  while IFS= read -r rel_path; do
    TARGETS+=("$WORKSPACE_DIR/$rel_path")
  done <<< "$SELECTED"
fi

for TARGET in "${TARGETS[@]}"; do
  TARGET=$(realpath "$TARGET")
  TARGET_NAME=$(basename "$TARGET")

  echo "──────────────────────────────────────────"
  echo "Repo: $TARGET_NAME ($TARGET)"

  if [[ ! -d "$TARGET/.git" ]]; then
    echo "  SKIP: not a git repository"
    continue
  fi

  # Warn and skip if working tree is dirty
  if ! git -C "$TARGET" diff --quiet || ! git -C "$TARGET" diff --cached --quiet; then
    echo "  WARN: working tree has uncommitted changes — skipping"
    continue
  fi

  DEFAULT_BRANCH=$(git -C "$TARGET" symbolic-ref refs/remotes/upstream/HEAD 2>/dev/null | sed 's|refs/remotes/upstream/||' || echo "master")

  # Switch to default branch
  CURRENT_BRANCH=$(git -C "$TARGET" rev-parse --abbrev-ref HEAD)
  if [[ "$CURRENT_BRANCH" != "$DEFAULT_BRANCH" ]]; then
    echo "  Switching from '$CURRENT_BRANCH' to '$DEFAULT_BRANCH'"
    git -C "$TARGET" checkout "$DEFAULT_BRANCH" --quiet
  fi

  # Fetch and fast-forward from upstream if available, otherwise origin
  if git -C "$TARGET" remote get-url upstream &>/dev/null; then
    git -C "$TARGET" fetch upstream "$DEFAULT_BRANCH" --quiet
    git -C "$TARGET" merge --ff-only "upstream/$DEFAULT_BRANCH" --quiet
    echo "  Synced from upstream/$DEFAULT_BRANCH"
  else
    git -C "$TARGET" pull --ff-only --quiet
    echo "  Synced from origin/$DEFAULT_BRANCH"
  fi
done

echo ""
echo "Done."
