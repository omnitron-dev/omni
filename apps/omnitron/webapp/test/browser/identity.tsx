import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { PrismProvider } from '@omnitron-dev/prism/core';
import { OmnitronBrand, OmnitronMark, OmnitronSplash, omnitronTheme } from '@omnitron-dev/prism/identity';
import SignInPage from '../../src/pages/auth/sign-in';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'light' ? 'light' : 'dark';
createRoot(document.getElementById('root')!).render(
  <PrismProvider themeOverrides={omnitronTheme} defaultSettings={{ mode, preset: 'minimal' }}>
    <MemoryRouter>
      <Box sx={{ p: { xs: 2, sm: 4 }, maxWidth: 1200, mx: 'auto' }}>
        <OmnitronBrand size={36} />
        <Typography variant="h3" sx={{ mt: 4, mb: 1 }}>Operational clarity.</Typography>
        <Typography color="text.secondary" sx={{ mb: 4 }}>One visual language for infrastructure and its documentation.</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
          <Card><CardContent><SignInPage /></CardContent></Card>
          <Stack spacing={3}>
            <Card><OmnitronSplash message="Checking your session…" /></Card>
            <Card><OmnitronSplash progress={37} message="Uploading archive" /></Card>
          </Stack>
          <Card><OmnitronSplash state="success" message="Workspace ready" /></Card>
          <Card><OmnitronSplash state="error" message="Connection lost" action={<Button variant="outlined">Retry connection</Button>} /></Card>
        </Box>
        <Stack direction="row" spacing={2} sx={{ mt: 4, alignItems: 'center' }}>
          {[16, 24, 32, 48].map(size => <OmnitronMark key={size} size={size} />)}
        </Stack>
      </Box>
    </MemoryRouter>
  </PrismProvider>,
);
