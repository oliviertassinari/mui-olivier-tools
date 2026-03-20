#!/usr/bin/env bash
# Propagate a commit from one MUI repo to one or more target repositories.
#
# Usage:
#   ./scripts/propagate-commit.sh <github-commit-url> [<target-repo-path> ...]
#
# Options:
#   --pr        Open a draft PR in each target repo after applying the commit (requires gh CLI)
#   --dry-run   Show what would be done without making any changes
#
# If no target repos are specified, an interactive selector loads repos from
# ~/mui.code-workspace (requires fzf).
#
# Examples:
#   ./scripts/propagate-commit.sh https://github.com/mui/material-ui/commit/f9413d1
#   ./scripts/propagate-commit.sh https://github.com/mui/material-ui/commit/f9413d1 --pr
#   ./scripts/propagate-commit.sh https://github.com/mui/material-ui/commit/f9413d1 --dry-run

set -euo pipefail

OPEN_PR=false
DRY_RUN=false
COMMIT_INPUT=""
TARGETS=()

for arg in "$@"; do
  if [[ "$arg" == "--pr" ]]; then
    OPEN_PR=true
  elif [[ "$arg" == "--dry-run" ]]; then
    DRY_RUN=true
  elif [[ -z "$COMMIT_INPUT" ]]; then
    COMMIT_INPUT="$arg"
  else
    TARGETS+=("$arg")
  fi
done

if [[ -z "$COMMIT_INPUT" ]]; then
  echo "Usage: $0 <github-commit-url> [<target-repo-path> ...] [--pr] [--dry-run]"
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
BRANCH_NAME="propagate-$(echo "$COMMIT_FULL" | head -c 8)"

# Strip trailing PR number from subject and build source PR URL
COMMIT_TITLE="${COMMIT_MSG% (#[0-9]*)}"
if [[ "$COMMIT_MSG" =~ \(#([0-9]+)\)$ ]]; then
  SOURCE_PR_URL="https://github.com/$GITHUB_ORG/$GITHUB_REPO/pull/${BASH_REMATCH[1]}"
else
  SOURCE_PR_URL="$COMMIT_URL"
fi
COMMIT_BODY="Cherry-pick $SOURCE_PR_URL"

echo "Propagating commit: $COMMIT_URL"
echo "Message: $COMMIT_TITLE"
[[ "$DRY_RUN" == "true" ]] && echo "(dry run — no changes will be made)"
echo ""

# If no targets specified, load from workspace and use fzf for selection
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  if ! command -v fzf &>/dev/null; then
    echo "Error: fzf is required for interactive repo selection (brew install fzf)"
    exit 1
  fi

  # Build "display-name<TAB>path" list, excluding the source repo
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

PATCH_FILE=$(mktemp /tmp/propagate-XXXXXX)
git -C "$SOURCE_REPO" format-patch -1 "$COMMIT_FULL" --stdout > "$PATCH_FILE"

for TARGET in "${TARGETS[@]}"; do
  TARGET=$(realpath "$TARGET")
  TARGET_NAME=$(basename "$TARGET")

  echo "──────────────────────────────────────────"
  echo "Target: $TARGET_NAME ($TARGET)"

  if [[ ! -d "$TARGET/.git" ]]; then
    echo "  SKIP: not a git repository"
    continue
  fi

  # Ensure working tree is clean
  if ! git -C "$TARGET" diff --quiet || ! git -C "$TARGET" diff --cached --quiet; then
    echo "  SKIP: working tree is dirty — commit or stash changes first"
    continue
  fi

  DEFAULT_BRANCH=$(git -C "$TARGET" symbolic-ref refs/remotes/upstream/HEAD 2>/dev/null | sed 's|refs/remotes/upstream/||' || echo "master")

  if [[ "$DRY_RUN" == "true" ]]; then
    if git -C "$TARGET" apply --check "$PATCH_FILE" 2>/dev/null; then
      if [[ "$OPEN_PR" == "true" ]]; then
        echo "  Would apply cleanly onto $DEFAULT_BRANCH as branch $BRANCH_NAME"
        echo "  Would open a draft PR: $COMMIT_TITLE"
      else
        echo "  Would apply cleanly onto $DEFAULT_BRANCH"
      fi
    else
      echo "  Would FAIL: patch does not apply"
    fi
    continue
  fi

  # Bring the default branch up to date with upstream
  git -C "$TARGET" fetch upstream "$DEFAULT_BRANCH" --quiet

  if [[ "$OPEN_PR" == "true" ]]; then
    git -C "$TARGET" checkout -B "$BRANCH_NAME" "upstream/$DEFAULT_BRANCH" --quiet
  else
    git -C "$TARGET" checkout "$DEFAULT_BRANCH" --quiet
    git -C "$TARGET" merge --ff-only "upstream/$DEFAULT_BRANCH" --quiet
  fi

  # Try to apply the patch
  if git -C "$TARGET" am --3way "$PATCH_FILE" 2>/dev/null; then
    git -C "$TARGET" commit --amend -m "$COMMIT_TITLE" -m "$COMMIT_BODY"
    echo "  Applied cleanly"
  else
    echo "  3-way merge failed, trying git apply..."
    git -C "$TARGET" am --abort 2>/dev/null || true
    if git -C "$TARGET" apply --check "$PATCH_FILE" 2>/dev/null; then
      git -C "$TARGET" apply "$PATCH_FILE"
      git -C "$TARGET" add -A
      git -C "$TARGET" commit -m "$COMMIT_TITLE" -m "$COMMIT_BODY" --allow-empty
      echo "  Applied via git apply"
    else
      echo "  FAILED: patch does not apply — manual intervention needed"
      git -C "$TARGET" checkout "$DEFAULT_BRANCH" --quiet 2>/dev/null || true
      continue
    fi
  fi

  if [[ "$OPEN_PR" == "true" ]]; then
    if ! command -v gh &>/dev/null; then
      echo "  SKIP PR: gh CLI not found"
      continue
    fi
    git -C "$TARGET" push origin "$BRANCH_NAME" --quiet
    PR_URL=$(gh -R "$(gh -C "$TARGET" repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || git -C "$TARGET" remote get-url origin)" pr create \
      --draft \
      --title "$COMMIT_TITLE" \
      --body "Propagated from $COMMIT_URL" \
      --head "$BRANCH_NAME" \
      2>&1 || true)
    echo "  PR: $PR_URL"
  else
    echo "  Commit applied to $DEFAULT_BRANCH"
  fi
done

rm -f "$PATCH_FILE"
echo ""
echo "Done."
