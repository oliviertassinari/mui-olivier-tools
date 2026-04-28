#!/usr/bin/env bash
# Stage and commit uncommitted changes in one or more target repositories,
# using a source commit as a metadata template (title + attribution body).
#
# Usage:
#   ./scripts/propagate-create-commits.sh <github-commit-url> [<target-repo-path> ...]
#
# Options:
#   --dry-run   Show what would be done without making any changes
#
# If no target repos are specified, an interactive selector loads repos from
# ~/mui.code-workspace (requires fzf).
#
# Per-target behaviour:
#   - If the repo has uncommitted changes → stage all, commit with the source commit title
#   - Otherwise → skip (nothing to commit)
#
# Examples:
#   ./scripts/propagate-create-commits.sh https://github.com/mui/material-ui/commit/f9413d1
#   ./scripts/propagate-create-commits.sh https://github.com/mui/material-ui/commit/f9413d1 --dry-run
#   ./scripts/propagate-create-commits.sh https://github.com/mui/material-ui/commit/f9413d1 ~/repos/mui-x

set -euo pipefail

DRY_RUN=false
COMMIT_INPUT=""
TARGETS=()

for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then
    DRY_RUN=true
  elif [[ -z "$COMMIT_INPUT" ]]; then
    COMMIT_INPUT="$arg"
  else
    TARGETS+=("$arg")
  fi
done

if [[ -z "$COMMIT_INPUT" ]]; then
  echo "Usage: $0 <github-commit-url> [<target-repo-path> ...] [--dry-run]"
  exit 1
fi

# Extract org, repo name, and hash from GitHub URL
if [[ "$COMMIT_INPUT" =~ ^https?://github\.com/([^/]+)/([^/]+)/commit/([a-f0-9]+) ]]; then
  GITHUB_ORG="${BASH_REMATCH[1]}"
  GITHUB_REPO="${BASH_REMATCH[2]}"
  COMMIT="${BASH_REMATCH[3]}"
  COMMIT_URL="$COMMIT_INPUT"
else
  echo "Error: expected a full GitHub commit URL (e.g. https://github.com/mui/material-ui/commit/f9413d1)"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required (brew install jq)"
  exit 1
fi

WORKSPACE_FILE="$HOME/mui.code-workspace"
if [[ ! -f "$WORKSPACE_FILE" ]]; then
  echo "Error: $WORKSPACE_FILE not found"
  exit 1
fi

WORKSPACE_DIR=$(dirname "$WORKSPACE_FILE")

# Find the local clone of the source repo from the workspace
SOURCE_REL=$(jq -r --arg repo "$GITHUB_REPO" \
  '.folders[] | select((.name // (.path | split("/") | last)) == $repo) | .path' \
  "$WORKSPACE_FILE" | head -1)

if [[ -z "$SOURCE_REL" ]]; then
  echo "Error: could not find a local clone of '$GITHUB_REPO' in $WORKSPACE_FILE"
  exit 1
fi

SOURCE_REPO="$WORKSPACE_DIR/$SOURCE_REL"
COMMIT_FULL=$(git -C "$SOURCE_REPO" rev-parse "$COMMIT")
COMMIT_MSG=$(git -C "$SOURCE_REPO" log -1 --format="%s" "$COMMIT_FULL")

# Strip trailing PR number and build source PR URL for attribution
COMMIT_TITLE="${COMMIT_MSG% (#[0-9]*)}"
if [[ "$COMMIT_MSG" =~ \(#([0-9]+)\)$ ]]; then
  SOURCE_PR_URL="https://github.com/$GITHUB_ORG/$GITHUB_REPO/pull/${BASH_REMATCH[1]}"
else
  SOURCE_PR_URL="$COMMIT_URL"
fi
COMMIT_BODY="Same as $SOURCE_PR_URL"

echo "Source commit: $COMMIT_URL"
echo "Title:         $COMMIT_TITLE"
[[ "$DRY_RUN" == "true" ]] && echo "(dry run — no changes will be made)"
echo ""

# If no targets specified, load from workspace and use fzf for selection
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  if ! command -v fzf &>/dev/null; then
    echo "Error: fzf is required for interactive repo selection (brew install fzf)"
    exit 1
  fi

  REPO_LIST=$(jq -r '.folders[] | (.name // (.path | split("/") | last)) + "\t" + .path' "$WORKSPACE_FILE" \
    | grep -v $'\t'"$GITHUB_REPO"$ \
    | grep -v $'\t'"mui-olivier-tools"$ \
    | grep -v $'\t'"mui-design-kits"$)

  SELECTED=$(echo "$REPO_LIST" \
    | fzf --multi \
          --with-nth=1 \
          --delimiter=$'\t' \
          --prompt="Select target repos (TAB=multi-select, ENTER=confirm): " \
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
  echo "Target: $TARGET_NAME ($TARGET)"

  if [[ ! -d "$TARGET/.git" ]]; then
    echo "  SKIP: not a git repository"
    continue
  fi

  HAS_STAGED=$(git -C "$TARGET" diff --cached --quiet && echo "no" || echo "yes")
  HAS_UNSTAGED=$(git -C "$TARGET" diff --quiet && echo "no" || echo "yes")
  HAS_UNTRACKED=$(git -C "$TARGET" ls-files --others --exclude-standard | head -1)

  HAS_CHANGES="no"
  [[ "$HAS_STAGED" == "yes" || "$HAS_UNSTAGED" == "yes" || -n "$HAS_UNTRACKED" ]] && HAS_CHANGES="yes"

  if [[ "$HAS_CHANGES" == "no" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "  Would pull from remote (no local changes)"
      continue
    fi
    if PULL_OUTPUT=$(git -C "$TARGET" pull --ff-only 2>&1); then
      if echo "$PULL_OUTPUT" | grep -q "Already up to date"; then
        echo "  SKIP: already up to date"
      else
        echo "  Pulled"
      fi
    else
      echo "  WARNING: could not sync with remote — $PULL_OUTPUT"
    fi
    continue
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  Would stage and commit all changes with message: $COMMIT_TITLE"
    continue
  fi

  git -C "$TARGET" add -A
  git -C "$TARGET" commit -m "$COMMIT_TITLE" -m "$COMMIT_BODY"
  echo "  Committed"
done

echo ""
echo "Done."
