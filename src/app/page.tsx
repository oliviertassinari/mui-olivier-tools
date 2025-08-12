'use client';

import React, { useState } from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Tabs,
  Tab,
  Box,
  Container,
  ThemeProvider,
  CssBaseline,
  createTheme,
} from '@mui/material';
import GitHubUsers from '@/components/GitHubUsers';
import NpmUsers from '@/components/NpmUsers';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
});

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

export default function Home() {
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            MUI Olivier Tools
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg">
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={handleTabChange} aria-label="tool tabs">
            <Tab label="GitHub /mui/ users" />
            <Tab label="GitHub /mui-org/ users" />
            <Tab label="npm users" />
          </Tabs>
        </Box>

        <TabPanel value={tabValue} index={0}>
          <GitHubUsers org="mui" title="GitHub /mui/ users" />
        </TabPanel>
        
        <TabPanel value={tabValue} index={1}>
          <GitHubUsers org="mui-org" title="GitHub /mui-org/ users" />
        </TabPanel>
        
        <TabPanel value={tabValue} index={2}>
          <NpmUsers />
        </TabPanel>
      </Container>
    </ThemeProvider>
  );
}
