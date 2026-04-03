import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import { AuthCenteredLayout } from '@omnitron/prism';

export function AuthLayout() {
  return (
    <AuthCenteredLayout maxWidth={460}>
      <Suspense
        fallback={
          <Box sx={{ width: '100%', pt: 2 }}>
            <LinearProgress />
          </Box>
        }
      >
        <Outlet />
      </Suspense>
    </AuthCenteredLayout>
  );
}
