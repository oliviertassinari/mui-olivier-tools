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
} from '@mui/material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import ReactMarkdown from 'react-markdown';

interface GitHubUser {
  login: string;
  type: string;
  site_admin: boolean;
}

interface GitHubUsersProps {
  org: string;
  title: string;
}

export default function GitHubUsers({ org, title }: GitHubUsersProps) {
  const [users, setUsers] = useState<GitHubUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [inviting, setInviting] = useState(false);
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const columns: GridColDef[] = [
    { field: 'login', headerName: 'Login', width: 177 },
    { field: 'type', headerName: 'Type', width: 150 },
    { field: 'site_admin', headerName: 'Site Admin', type: 'boolean', width: 120 },
  ];

  useEffect(() => {
    fetchUsers();
  }, [org]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/github/users?org=${org}`);
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
    if (!username.trim()) return;

    try {
      setInviting(true);
      setError(null);
      const response = await fetch('/api/github/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, org }),
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
        {title}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ height: 400, width: '100%', mb: 4 }}>
        <DataGrid
          rows={users}
          columns={columns}
          loading={loading}
          getRowId={(row) => row.login}
          pageSizeOptions={[25, 50, 100]}
        />
      </Box>

      <Typography variant="h4" component="h2" gutterBottom>
        Invite new user
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <TextField
          label="new user GitHub username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          sx={{ width: 300 }}
        />
        <Button
          variant="contained"
          onClick={handleInvite}
          disabled={!username.trim() || inviting}
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
    </Container>
  );
}