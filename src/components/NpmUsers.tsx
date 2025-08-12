'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Container,
  Alert,
  Card,
  CardContent,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Grid,
} from '@mui/material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';

interface NpmUser {
  name: string;
  role: string;
}

const orgOptions = [
  { value: 'mui', label: '@mui' },
  { value: 'toolpad', label: '@toolpad' },
  { value: 'pigment-css', label: '@pigment-css' },
  { value: 'base-ui', label: '@base-ui' },
  { value: 'base-ui-components', label: '@base-ui-components' },
];

export default function NpmUsers() {
  const [users, setUsers] = useState<NpmUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState('');
  const [selectedOrg, setSelectedOrg] = useState('mui');
  const [inviting, setInviting] = useState(false);
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const columns: GridColDef[] = [
    { field: 'name', headerName: 'Name', width: 156 },
    { field: 'role', headerName: 'Role', width: 150 },
  ];

  useEffect(() => {
    fetchUsers();
  }, [selectedOrg]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/npm/users?org=${selectedOrg}`);
      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }
      const data = await response.json();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async () => {
    if (!slug.trim()) return;

    try {
      setInviting(true);
      setError(null);
      const response = await fetch('/api/npm/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ org: selectedOrg, slug }),
      });
      
      const data = await response.json();
      setResponse(data);
      
      if (response.ok) {
        // Refresh users list
        fetchUsers();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite user');
    } finally {
      setInviting(false);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h3" component="h1" gutterBottom>
        npm users
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Grid item>
          <Typography>org name:</Typography>
        </Grid>
        <Grid item>
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel>Organization</InputLabel>
            <Select
              value={selectedOrg}
              onChange={(e) => setSelectedOrg(e.target.value)}
              label="Organization"
            >
              {orgOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
      </Grid>

      <Box sx={{ height: 400, width: '100%', mb: 4 }}>
        <DataGrid
          rows={users}
          columns={columns}
          loading={loading}
          getRowId={(row) => row.name}
          pageSizeOptions={[25, 50, 100]}
        />
      </Box>

      <Typography variant="h4" component="h2" gutterBottom>
        Invite new user
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <TextField
          label="new user npm slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          sx={{ width: 300 }}
        />
        <Button
          variant="contained"
          onClick={handleInvite}
          disabled={!slug.trim() || inviting}
        >
          {inviting ? 'Inviting...' : 'Invite'}
        </Button>
      </Box>

      {response && (
        <Card sx={{ mt: 2 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Response:
            </Typography>
            <Box
              component="pre"
              sx={{
                backgroundColor: '#f5f5f5',
                p: 2,
                borderRadius: 1,
                overflow: 'auto',
                fontFamily: 'monospace',
                fontSize: '0.875rem',
              }}
            >
              {JSON.stringify(response, null, 2)}
            </Box>
          </CardContent>
        </Card>
      )}

      <Typography variant="h4" component="h2" sx={{ mt: 4 }} gutterBottom>
        process.env.NPM_TOKEN
      </Typography>
      
      <Card sx={{ mt: 2 }}>
        <CardContent>
          <Typography>
            Token to renew in https://www.npmjs.com/settings/oliviertassinari/tokens/granular-access-tokens/new.
          </Typography>
          <Typography sx={{ mt: 1 }}>
            You need to set:
          </Typography>
          <Typography component="ul" sx={{ mt: 1 }}>
            <li>Packages and scopes: no permissions</li>
            <li>Organizations: read and right to the relevant organizations</li>
          </Typography>
          <Typography sx={{ mt: 1 }}>
            Set the expiration date to be 4 years.
          </Typography>
        </CardContent>
      </Card>
    </Container>
  );
}