import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import { MenuIcon, StarIcon, MoreIcon } from '../../../src/icons';
import { HeaderSection } from '../../../src/layouts/core/header-section';

/** Neutral slot combinations exercise geometry independently of application data. */
export function HeaderLayoutTestPage() {
  const params = new URLSearchParams(window.location.search);
  const context = params.has('context');
  const search = params.has('search');
  return (
    <>
      <HeaderSection
        containerized={params.has('containerized')}
        slots={{
          topArea: <Alert>Scheduled maintenance starts in 30 minutes.</Alert>,
          leftArea: (
            <>
              <IconButton aria-label="Open navigation">
                <MenuIcon />
              </IconButton>
              {context && <Chip label="International research workspace" sx={{ maxWidth: 200, minWidth: 0 }} />}
              <IconButton aria-label="Saved pages">
                <StarIcon />
              </IconButton>
            </>
          ),
          centerArea: search ? (
            <InputBase placeholder="Search the workspace" sx={{ width: '100%', minWidth: 0 }} />
          ) : undefined,
          rightArea: (
            <Box sx={{ display: 'flex', gap: 1 }}>
              {['Messages', 'Notifications', 'Preferences', 'Account'].map((label) => (
                <IconButton key={label} aria-label={label}>
                  <MoreIcon />
                </IconButton>
              ))}
            </Box>
          ),
        }}
      />
      <Box component="main" sx={{ p: 2, minHeight: '200vh' }}>
        Workspace content
      </Box>
    </>
  );
}
