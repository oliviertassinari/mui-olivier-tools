#!/usr/bin/env bash
# Find the email(s) a GitHub user commits with.
#
# Usage:
#   ./scripts/github-email.sh <username>
#
# Requires: gh (authenticated).
set -euo pipefail
export GH_PAGER=cat

user="${1:?usage: github-email.sh <username>}"

# Count emails from "name <email>" lines on stdin, hiding GitHub noreply addresses.
summarize() {
  local lines real
  lines=$(cat)
  real=$(grep -v 'users.noreply.github.com' <<<"$lines" | grep . || true)
  if [[ -n "$real" ]]; then
    sort <<<"$real" | uniq -c | sort -rn
  elif [[ -n "$lines" ]]; then
    echo "(only users.noreply.github.com addresses found)"
  else
    echo "(no commits found)"
  fi
}

echo "== Profile"
gh api "users/$user" --jq '"name:  \(.name // "-")\nemail: \(.email // "-")\nblog:  \(.blog // "-")"'

echo
echo "== Commit search (all public repos)"
gh api -X GET search/commits -f q="author:$user" -f sort=author-date -f per_page=100 \
  --jq '.items[] | .commit.author.name + " <" + .commit.author.email + ">"' 2>/dev/null \
  | summarize

echo
echo "== Commits in own recently pushed repos"
for repo in $(gh api "users/$user/repos?sort=pushed&per_page=30" --jq '.[] | select(.fork|not) | .full_name' | head -5); do
  gh api "repos/$repo/commits?author=$user&per_page=50" \
    --jq '.[] | .commit.author.name + " <" + .commit.author.email + ">"' 2>/dev/null || true
done | summarize
