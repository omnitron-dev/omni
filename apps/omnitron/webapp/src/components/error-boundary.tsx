import { Component, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h5" gutterBottom>Something went wrong</Typography>
          <Typography color="text.secondary" sx={{ mb: 2, fontFamily: 'monospace', fontSize: '0.85rem' }}>
            {this.state.error?.message}
          </Typography>
          <Button variant="contained" onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}>
            Reload
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}
