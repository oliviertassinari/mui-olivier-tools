#!/usr/bin/env node
// Rename PR/issue titles by replacing a prefix in the given repo.
// Usage: node scripts/rename-pr-titles.mjs <owner/repo> --from <old> --to <new> [--label <label>] [--type pr|issue|both] [--dry-run]
// Example: node scripts/rename-pr-titles.mjs mui/material-ui --from "[infra]" --to "[code-infra]" --label bug --type both --dry-run

import { execSync, execFileSync } from "node:child_process";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error(
    "Usage: rename-pr-titles.mjs <owner/repo> --from <old> --to <new> [--label <label>] [--type pr|issue|both] [--dry-run]"
  );
  process.exit(1);
}

const repo = args[0];
let from = "";
let to = "";
let label = "";
let type = "both";
let dryRun = false;

for (let i = 1; i < args.length; i++) {
  switch (args[i]) {
    case "--from":
      from = args[++i];
      break;
    case "--to":
      to = args[++i];
      break;
    case "--label":
      label = args[++i];
      break;
    case "--type":
      type = args[++i];
      break;
    case "--dry-run":
      dryRun = true;
      break;
    default:
      console.error(`Unknown option: ${args[i]}`);
      process.exit(1);
  }
}

if (!from || !to) {
  console.error("Error: --from and --to are required.");
  process.exit(1);
}

if (dryRun) {
  console.log("Dry run mode — no changes will be made.");
}

function renameItems(kind) {
  const listArgs = [kind, "list", "--repo", repo, "--state", "all", "--limit", "1000"];
  if (label) {
    listArgs.push("--label", label);
  }
  listArgs.push("--json", "number,title");
  const output = execFileSync("gh", listArgs, { encoding: "utf8" });
  const items = JSON.parse(output);

  for (const item of items) {
    if (!item.title.startsWith(from)) {
      continue;
    }
    const newTitle = to + item.title.slice(from.length);
    console.log(
      `${kind.toUpperCase()} #${item.number}: ${item.title} -> ${newTitle}`
    );
    if (!dryRun) {
      execFileSync(
        "gh",
        [kind, "edit", String(item.number), "--repo", repo, "--title", newTitle],
        { stdio: "inherit" }
      );
    }
  }
}

if (type === "pr" || type === "both") {
  renameItems("pr");
}

if (type === "issue" || type === "both") {
  renameItems("issue");
}
