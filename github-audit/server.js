import { execFileSync } from 'node:child_process';
import express from 'express';
import { Octokit } from '@octokit/rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import pLimit from 'p-limit';

const PORT = process.env.PORT || 3000;
const DEFAULT_SINCE = '2026-01-01';
const HYDRATION_CONCURRENCY = 6;

function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

const MyOctokit = Octokit.plugin(retry, throttling);
const octokit = new MyOctokit({
  auth: resolveToken(),
  throttle: {
    // The primary (core/search) quota only resets on the hour, so retryAfter
    // here can be up to ~3600s — retrying would block the request for that
    // long with no feedback. Fail fast instead; the route handler turns this
    // into a 429 with the reset time so the caller can decide what to do.
    onRateLimit: (retryAfter, options) => {
      console.warn(`Primary rate limit hit for ${options.method} ${options.url}, resets in ${retryAfter}s`);
      return false;
    },
    // Secondary (abuse-detection) limits are short-lived — usually a minute
    // or less — and are typically self-inflicted by request bursts, so a
    // couple of retries is worth it.
    onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
      console.warn(`Secondary rate limit hit for ${options.method} ${options.url}, resets in ${retryAfter}s`);
      return retryCount < 2;
    },
  },
});

function isPrimaryRateLimitError(err) {
  return err?.status === 403 && err?.response?.headers?.['x-ratelimit-remaining'] === '0';
}

function rateLimitInfoFromError(err) {
  const headers = err?.response?.headers || {};
  const resetEpochSeconds = Number(headers['x-ratelimit-reset']);
  const nowEpochSeconds = Date.now() / 1000;
  return {
    limit: Number(headers['x-ratelimit-limit']) || undefined,
    resetAt: resetEpochSeconds ? new Date(resetEpochSeconds * 1000).toISOString() : undefined,
    retryAfterSeconds: resetEpochSeconds ? Math.max(0, Math.ceil(resetEpochSeconds - nowEpochSeconds)) : undefined,
  };
}

function sameUser(login, username) {
  return typeof login === 'string' && login.toLowerCase() === username.toLowerCase();
}

function onOrAfter(dateStr, sinceMs) {
  return new Date(dateStr).getTime() >= sinceMs;
}

function onOrBefore(dateStr, untilMs) {
  return new Date(dateStr).getTime() <= untilMs;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Fetches everything a single user did on a single issue/PR: conversation
// comments, and — for PRs — reviews, inline review comments, and commits.
async function hydrateItem(item, owner, repo, username, sinceMs, untilMs) {
  const number = item.number;
  const isPR = Boolean(item.pull_request);
  const result = { issueComments: [], prComments: [], prReviews: [], prCommits: [], prMerged: [] };
  const inRange = (dateStr) => onOrAfter(dateStr, sinceMs) && onOrBefore(dateStr, untilMs);

  const conversationComments = await octokit.paginate(
    octokit.issues.listComments,
    { owner, repo, issue_number: number, per_page: 100 },
  );
  const matchedConversation = conversationComments
    .filter((c) => sameUser(c.user?.login, username) && inRange(c.created_at))
    .map((c) => ({
      number,
      title: item.title,
      url: c.html_url,
      date: c.created_at,
      body: c.body,
    }));
  if (isPR) result.prComments.push(...matchedConversation);
  else result.issueComments.push(...matchedConversation);

  if (!isPR) return result;

  const mergedAt = item.pull_request?.merged_at;
  if (mergedAt && sameUser(item.user?.login, username) && inRange(mergedAt)) {
    result.prMerged.push({
      number,
      title: item.title,
      url: item.html_url,
      date: mergedAt,
    });
  }

  const [reviews, reviewComments, commits] = await Promise.all([
    octokit.paginate(octokit.pulls.listReviews, { owner, repo, pull_number: number, per_page: 100 }),
    octokit.paginate(octokit.pulls.listReviewComments, { owner, repo, pull_number: number, per_page: 100 }),
    octokit.paginate(octokit.pulls.listCommits, { owner, repo, pull_number: number, per_page: 100 }),
  ]);

  result.prReviews.push(
    ...reviews
      .filter((r) => sameUser(r.user?.login, username) && r.submitted_at && inRange(r.submitted_at))
      .map((r) => ({
        number,
        title: item.title,
        url: r.html_url,
        date: r.submitted_at,
        state: r.state,
        body: r.body,
      })),
  );

  result.prComments.push(
    ...reviewComments
      .filter((c) => sameUser(c.user?.login, username) && inRange(c.created_at))
      .map((c) => ({
        number,
        title: item.title,
        url: c.html_url,
        date: c.created_at,
        body: c.body,
        path: c.path,
      })),
  );

  result.prCommits.push(
    ...commits
      .filter((commit) => {
        const authorDate = commit.commit?.author?.date;
        // GitHub can only set commit.author (the linked account) when the
        // commit's git email is verified on that account; otherwise it's
        // null even though the commit clearly belongs to the user, so fall
        // back to the raw git author name recorded in the commit itself.
        const matchesUser =
          sameUser(commit.author?.login, username) ||
          (!commit.author && sameUser(commit.commit?.author?.name, username));
        return matchesUser && authorDate && inRange(authorDate);
      })
      .map((commit) => ({
        number,
        title: item.title,
        url: commit.html_url,
        date: commit.commit.author.date,
        sha: commit.sha,
        message: commit.commit.message,
      })),
  );

  return result;
}

async function auditUser({ owner, repo, username, since, until }) {
  const sinceMs = new Date(since).getTime();
  if (Number.isNaN(sinceMs)) {
    throw new Error(`Invalid "since" date: ${since}`);
  }
  // End-of-day so items dated on `until` itself are included.
  const untilMs = new Date(`${until}T23:59:59.999Z`).getTime();
  if (Number.isNaN(untilMs)) {
    throw new Error(`Invalid "until" date: ${until}`);
  }

  // `involves` finds every issue/PR the user touched (author, commenter,
  // reviewer, assignee, mentioned); per-item calls below apply the precise
  // date filter. `updated:` narrows candidates but can miss a thread whose
  // last update falls outside the range even though the user's own activity
  // on it doesn't — an accepted trade-off to keep the search bounded.
  const query = `repo:${owner}/${repo} involves:${username} updated:${since}..${until}`;
  const items = await octokit.paginate(octokit.search.issuesAndPullRequests, {
    q: query,
    per_page: 100,
  });

  const limit = pLimit(HYDRATION_CONCURRENCY);
  const settled = await Promise.allSettled(
    items.map((item) => limit(() => hydrateItem(item, owner, repo, username, sinceMs, untilMs))),
  );

  const merged = { issueComments: [], prComments: [], prReviews: [], prCommits: [], prMerged: [] };
  let rateLimit;
  let itemsSkipped = 0;
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      merged.issueComments.push(...result.value.issueComments);
      merged.prComments.push(...result.value.prComments);
      merged.prReviews.push(...result.value.prReviews);
      merged.prCommits.push(...result.value.prCommits);
      merged.prMerged.push(...result.value.prMerged);
    } else if (isPrimaryRateLimitError(result.reason)) {
      // Quota ran out mid-batch: keep whatever hydrated successfully instead
      // of throwing away completed work, and flag the response as partial.
      rateLimit = rateLimitInfoFromError(result.reason);
      itemsSkipped += 1;
    } else {
      throw result.reason;
    }
  }
  for (const key of Object.keys(merged)) {
    merged[key].sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  return {
    owner,
    repo,
    username,
    since,
    until,
    threadsScanned: items.length,
    ...(rateLimit ? { partial: true, itemsSkipped, rateLimit } : {}),
    summary: {
      issueComments: merged.issueComments.length,
      prComments: merged.prComments.length,
      prReviews: merged.prReviews.length,
      prCommits: merged.prCommits.length,
      prMerged: merged.prMerged.length,
    },
    ...merged,
  };
}

const app = express();

app.get('/', (_req, res) => {
  res.json({
    usage: 'GET /audit/:owner/:repo/:username?since=YYYY-MM-DD&until=YYYY-MM-DD',
    example: '/audit/mui/mui-x/oliviertassinari?since=2026-06-01&until=2026-07-20',
    defaultSince: DEFAULT_SINCE,
    defaultUntil: todayStr(),
  });
});

app.get('/rate-limit', async (_req, res) => {
  const { data } = await octokit.rateLimit.get();
  res.json(data.resources);
});

app.get('/audit/:owner/:repo/:username', async (req, res) => {
  const { owner, repo, username } = req.params;
  const since = req.query.since || DEFAULT_SINCE;
  const until = req.query.until || todayStr();
  try {
    const result = await auditUser({ owner, repo, username, since, until });
    res.json(result);
  } catch (err) {
    if (isPrimaryRateLimitError(err)) {
      return res.status(429).json({ error: 'GitHub API rate limit exceeded', ...rateLimitInfoFromError(err) });
    }
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Try: http://localhost:${PORT}/audit/mui/mui-x/oliviertassinari?since=2026-06-01`);
});
