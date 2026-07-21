import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { DataGridPremium, GridToolbar } from '@mui/x-data-grid-premium';

const CATEGORIES = [
  { key: 'issueComments', label: 'Issue comments', color: '#51528d' },
  { key: 'prComments', label: 'PR comments', color: '#689636' },
  { key: 'prReviews', label: 'PR reviews', color: '#ed8535' },
  { key: 'prCommits', label: 'PR commits', color: '#8a5eb0' },
  { key: 'prMerged', label: 'PRs merged', color: '#e75454' },
];

function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

function buildMonthlyDataset(data) {
  const months = new Set();
  for (const { key } of CATEGORIES) {
    for (const item of data[key]) months.add(monthKey(item.date));
  }
  const sortedMonths = [...months].sort();
  return sortedMonths.map((month) => {
    const row = { month };
    for (const { key } of CATEGORIES) {
      row[key] = data[key].filter((item) => monthKey(item.date) === month).length;
    }
    return row;
  });
}

function buildRows(data) {
  const rows = [];
  for (const { key, label } of CATEGORIES) {
    for (const item of data[key]) {
      rows.push({
        id: `${item.repo}:${key}:${item.url}`,
        repo: item.repo,
        category: label,
        number: item.number,
        title: item.title,
        month: monthKey(item.date),
        date: item.date,
        detail: item.state || item.message || item.body || '',
        url: item.url,
      });
    }
  }
  return rows;
}

const GRID_COLUMNS = [
  { field: 'repo', headerName: 'Repo', width: 160 },
  { field: 'category', headerName: 'Category', width: 140 },
  { field: 'number', headerName: '#', width: 90, type: 'number' },
  { field: 'month', headerName: 'Month', width: 100 },
  { field: 'title', headerName: 'Title', flex: 1, minWidth: 220 },
  {
    field: 'date',
    headerName: 'Date',
    width: 170,
    type: 'dateTime',
    valueGetter: (value) => new Date(value),
  },
  { field: 'detail', headerName: 'Detail', flex: 1.5, minWidth: 240 },
  {
    field: 'url',
    headerName: 'Link',
    width: 80,
    sortable: false,
    filterable: false,
    groupable: false,
    renderCell: (params) => (
      <a href={params.value} target="_blank" rel="noreferrer">
        Open
      </a>
    ),
  },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function parseRepos(reposInput) {
  return [...new Set(reposInput.split(',').map((r) => r.trim()).filter(Boolean))];
}

async function fetchRepoAudit(owner, repo, username, since, until) {
  const res = await fetch(
    `/audit/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(username)}?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`,
  );
  const body = await res.json();
  if (res.status === 429) {
    const resetAt = body.resetAt ? new Date(body.resetAt).toLocaleTimeString() : 'unknown';
    throw new Error(`GitHub API rate limit exceeded, resets at ${resetAt}`);
  }
  if (!res.ok) throw new Error(body.error || `Request failed with ${res.status}`);
  return body;
}

function mergeRepoAudits(owner, username, since, until, settledResults, repoNames) {
  const merged = Object.fromEntries(CATEGORIES.map(({ key }) => [key, []]));
  const perRepo = [];
  const failed = [];
  const partial = [];
  let threadsScanned = 0;

  settledResults.forEach((result, i) => {
    const repo = repoNames[i];
    if (result.status === 'rejected') {
      failed.push({ repo, message: result.reason.message });
      return;
    }
    const body = result.value;
    threadsScanned += body.threadsScanned;
    perRepo.push({ repo, summary: body.summary, threadsScanned: body.threadsScanned });
    if (body.partial) {
      const resetAt = body.rateLimit?.resetAt ? new Date(body.rateLimit.resetAt).toLocaleTimeString() : 'unknown';
      partial.push({ repo, itemsSkipped: body.itemsSkipped, resetAt });
    }
    for (const { key } of CATEGORIES) {
      for (const item of body[key]) merged[key].push({ ...item, repo });
    }
  });

  const summary = Object.fromEntries(CATEGORIES.map(({ key }) => [key, merged[key].length]));

  return {
    owner,
    username,
    since,
    until,
    repos: perRepo.map((r) => r.repo),
    perRepo,
    failed,
    partial,
    threadsScanned,
    summary,
    ...merged,
  };
}

export default function App() {
  const [owner, setOwner] = useState('mui');
  const [reposInput, setReposInput] = useState('material-ui,mui-x');
  const [username, setUsername] = useState('oliviertassinari');
  const [since, setSince] = useState('2025-06-01');
  const [until, setUntil] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const monthlyDataset = useMemo(() => (data ? buildMonthlyDataset(data) : []), [data]);
  const rows = useMemo(() => (data ? buildRows(data) : []), [data]);

  async function handleSubmit(event) {
    event.preventDefault();
    const repoNames = parseRepos(reposInput);
    if (repoNames.length === 0) {
      setError('Enter at least one repo.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const settledResults = await Promise.allSettled(
        repoNames.map((repo) => fetchRepoAudit(owner, repo, username, since, until)),
      );
      const merged = mergeRepoAudits(owner, username, since, until, settledResults, repoNames);
      if (merged.repos.length === 0) {
        throw new Error(merged.failed.map((f) => `${f.repo}: ${f.message}`).join('; '));
      }
      setData(merged);
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        GitHub activity audit
      </Typography>

      <Paper variant="outlined" sx={{ p: 3, mb: 4 }}>
        <Box component="form" onSubmit={handleSubmit}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <TextField label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} fullWidth />
            <TextField
              label="Repos (comma-separated)"
              value={reposInput}
              onChange={(e) => setReposInput(e.target.value)}
              placeholder="mui-x, material-ui, base-ui"
              fullWidth
            />
            <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} fullWidth />
            <TextField
              label="Since"
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
            <TextField
              label="Up to"
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Stack>
          <Button type="submit" variant="contained" disabled={loading}>
            {loading ? 'Loading…' : 'Run audit'}
          </Button>
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 4 }}>
          {error}
        </Alert>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {data && !loading && (
        <Stack spacing={4}>
          {data.failed.length > 0 && (
            <Alert severity="warning">
              Failed to fetch: {data.failed.map((f) => `${f.repo} (${f.message})`).join('; ')}
            </Alert>
          )}

          {data.partial.length > 0 && (
            <Alert severity="warning">
              Rate limit hit mid-fetch, results are incomplete for:{' '}
              {data.partial.map((p) => `${p.repo} (${p.itemsSkipped} threads skipped, resets at ${p.resetAt})`).join('; ')}
            </Alert>
          )}

          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {data.threadsScanned} threads scanned for {data.username} since {data.since} up to {data.until},
              across {data.repos.length} {data.repos.length === 1 ? 'repo' : 'repos'}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {data.perRepo.map(({ repo, threadsScanned }) => (
                <Chip key={repo} label={`${data.owner}/${repo}: ${threadsScanned} threads`} size="small" />
              ))}
            </Stack>
          </Box>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Activity by month
            </Typography>
            <BarChart
              dataset={monthlyDataset}
              xAxis={[{ scaleType: 'band', dataKey: 'month' }]}
              series={CATEGORIES.map(({ key, label, color }) => ({
                dataKey: key,
                label,
                color,
                stack: 'total',
              }))}
              height={350}
            />
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              All activity
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Right-click a column header to group by it (e.g. category, month, or #).
            </Typography>
            <Box sx={{ height: 600 }}>
              <DataGridPremium
                rows={rows}
                columns={GRID_COLUMNS}
                slots={{ toolbar: GridToolbar }}
                initialState={{
                  rowGrouping: { model: ['repo', 'category'] },
                  pagination: { paginationModel: { pageSize: 25 } },
                }}
                pageSizeOptions={[25, 50, 100]}
              />
            </Box>
          </Paper>
        </Stack>
      )}
    </Container>
  );
}
