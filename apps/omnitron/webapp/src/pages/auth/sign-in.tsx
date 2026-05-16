import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { EyeIcon } from 'src/assets/icons';

import { useAuthStore } from 'src/auth/store';
import { OmnitronLogo } from 'src/components/omnitron-logo';
import { classifyRpcError, sanitizeReturnTo } from 'src/utils/errors';
import { useBackendOnline } from 'src/stores/backend-status.store';

export default function SignInPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const signIn = useAuthStore((s) => s.signIn);
  const backendOnline = useBackendOnline();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    setError('');
    setSubmitting(true);

    try {
      await signIn(username, password);
      navigate(returnTo, { replace: true });
    } catch (err: unknown) {
      setPassword('');
      setError(classifyRpcError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 420, mx: 'auto', width: 1 }}>
      <Stack
        spacing={1.5}
        sx={{
          alignItems: "center",
          textAlign: "center"
        }}>
        <OmnitronLogo size={48} />
        <Typography variant="h4">Omnitron Console</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          Sign in to manage your infrastructure
        </Typography>
      </Stack>
      {error && (
        <Alert severity="error" variant="outlined" onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <Stack spacing={2.5}>
          <TextField
            fullWidth
            label="Username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />

          <TextField
            fullWidth
            label="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                      {<EyeIcon open={showPassword} />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />

          <Button
            fullWidth
            size="large"
            type="submit"
            variant="contained"
            disabled={submitting || !backendOnline}
            startIcon={submitting ? <CircularProgress size={20} color="inherit" /> : undefined}
          >
            {submitting ? 'Signing in...' : !backendOnline ? 'Daemon offline' : 'Sign In'}
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}
