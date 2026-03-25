#!/usr/bin/env bash
# Open PRs in one or more target repositories using a sample PR as a metadata template.
# The changes come from each target repo's current working tree / branch — not from the
# sample PR's diff.
#
# Usage:
#   ./scripts/propagate-create-prs.sh <sample-pr-url> [<target-repo-path> ...]
#
# Options:
#   --dry-run   Show what would be done without making any changes
#
# If no target repos are specified, an interactive selector loads repos from
# ~/mui.code-workspace (requires fzf).
#
# Per-target behaviour:
#   - If the repo is already on a feature branch with commits ahead of upstream → push + open PR
#   - If the repo has uncommitted changes → stage all, commit with the sample PR title, push + open PR
#   - Otherwise → skip (nothing to open a PR for)
#
# Examples:
#   ./scripts/propagate-create-prs.sh https://github.com/mui/material-ui/pull/12345
#   ./scripts/propagate-create-prs.sh https://github.com/mui/material-ui/pull/12345 --dry-run
#   ./scripts/propagate-create-prs.sh https://github.com/mui/material-ui/pull/12345 ~/repos/mui-x

set -euo pipefail

DRY_RUN=false
PR_INPUT=""
TARGETS=()

for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then
    DRY_RUN=true
  elif [[ -z "$PR_INPUT" ]]; then
    PR_INPUT="$arg"
  else
    TARGETS+=("$arg")
  fi
done

if [[ -z "$PR_INPUT" ]]; then
  echo "Usage: $0 <sample-pr-url> [<target-repo-path> ...] [--dry-run]"
  exit 1
fi

# Extract org, repo name, and PR number from GitHub URL
if [[ "$PR_INPUT" =~ ^https?://github\.com/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
  GITHUB_ORG="${BASH_REMATCH[1]}"
  GITHUB_REPO="${BASH_REMATCH[2]}"
  PR_NUMBER="${BASH_REMATCH[3]}"
else
  echo "Error: expected a full GitHub PR URL (e.g. https://github.com/mui/material-ui/pull/12345)"
  exit 1
fi

if ! command -v gh &>/dev/null; then
  echo "Error: gh CLI is required (brew install gh)"
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

# Fetch PR metadata from the sample PR
echo "Fetching PR metadata from GitHub..."
PR_JSON=$(gh pr view "$PR_NUMBER" --repo "$GITHUB_ORG/$GITHUB_REPO" \
  --json title,body,isDraft,headRefName)

PR_TITLE=$(echo "$PR_JSON" | jq -r '.title')
PR_BODY=$(echo "$PR_JSON" | jq -r '.body // ""')
PR_IS_DRAFT=$(echo "$PR_JSON" | jq -r '.isDraft')
PR_HEAD_BRANCH=$(echo "$PR_JSON" | jq -r '.headRefName')

# Append attribution to body
ATTRIBUTION="Same as $PR_INPUT"
if [[ -n "$PR_BODY" ]]; then
  NEW_BODY="${PR_BODY}"$'\n\n'"${ATTRIBUTION}"
else
  NEW_BODY="$ATTRIBUTION"
fi

DRAFT_FLAG=""
[[ "$PR_IS_DRAFT" == "true" ]] && DRAFT_FLAG="--draft"

echo "Sample PR:  $PR_INPUT"
echo "Title:      $PR_TITLE"
echo "Branch:     $PR_HEAD_BRANCH"
echo "Draft:      $PR_IS_DRAFT"
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

  DEFAULT_BRANCH=$(git -C "$TARGET" symbolic-ref refs/remotes/upstream/HEAD 2>/dev/null \
    | sed 's|refs/remotes/upstream/||' || echo "master")

  CURRENT_BRANCH=$(git -C "$TARGET" rev-parse --abbrev-ref HEAD)
  HAS_STAGED=$(git -C "$TARGET" diff --cached --quiet && echo "no" || echo "yes")
  HAS_UNSTAGED=$(git -C "$TARGET" diff --quiet && echo "no" || echo "yes")
  HAS_UNTRACKED=$(git -C "$TARGET" ls-files --others --exclude-standard | head -1)

  ON_FEATURE_BRANCH="no"
  COMMITS_AHEAD=0
  if [[ "$CURRENT_BRANCH" != "$DEFAULT_BRANCH" ]]; then
    git -C "$TARGET" fetch upstream "$DEFAULT_BRANCH" --quiet 2>/dev/null || true
    COMMITS_AHEAD=$(git -C "$TARGET" rev-list --count "upstream/$DEFAULT_BRANCH..HEAD" 2>/dev/null || echo 0)
    [[ "$COMMITS_AHEAD" -gt 0 ]] && ON_FEATURE_BRANCH="yes"
  fi

  HAS_CHANGES="no"
  [[ "$HAS_STAGED" == "yes" || "$HAS_UNSTAGED" == "yes" || -n "$HAS_UNTRACKED" ]] && HAS_CHANGES="yes"

  if [[ "$ON_FEATURE_BRANCH" == "no" && "$HAS_CHANGES" == "no" ]]; then
    echo "  SKIP: no uncommitted changes and not on a feature branch ahead of $DEFAULT_BRANCH"
    continue
  fi

  # Determine which branch name to push on
  if [[ "$CURRENT_BRANCH" == "$DEFAULT_BRANCH" ]]; then
    PUSH_BRANCH="$PR_HEAD_BRANCH"
  else
    PUSH_BRANCH="$CURRENT_BRANCH"
  fi

  if [[ "$HAS_CHANGES" == "yes" ]]; then
    echo "  Uncommitted changes detected — will stage and commit"
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "  Would commit all changes with message: $PR_TITLE"
      echo "  Would push branch '$PUSH_BRANCH' and open PR: $PR_TITLE"
      continue
    fi
    if [[ "$CURRENT_BRANCH" == "$DEFAULT_BRANCH" ]]; then
      git -C "$TARGET" checkout -b "$PUSH_BRANCH" --quiet
    fi
    git -C "$TARGET" add -A
    git -C "$TARGET" commit -m "$PR_TITLE"
  else
    echo "  Branch '$PUSH_BRANCH' has $COMMITS_AHEAD commit(s) ahead of $DEFAULT_BRANCH"
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "  Would push branch '$PUSH_BRANCH' and open PR: $PR_TITLE"
      continue
    fi
  fi

  git -C "$TARGET" push origin "$PUSH_BRANCH" --force-with-lease --quiet

  TARGET_REPO=$(gh -C "$TARGET" repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null \
    || git -C "$TARGET" remote get-url origin)

  PR_URL=$(gh pr create \
    --repo "$TARGET_REPO" \
    $DRAFT_FLAG \
    --title "$PR_TITLE" \
    --body "$NEW_BODY" \
    --head "$PUSH_BRANCH" \
    --base "$DEFAULT_BRANCH" \
    2>&1 || true)

  echo "  PR: $PR_URL"
done

echo ""
echo "Done."
