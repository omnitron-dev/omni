/**
 * DashboardBlock Test Page
 *
 * Renders DashboardBlock in various states for E2E testing.
 */

import { useSearchParams, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';

import { DashboardBlock, useDashboardBlock } from '../../../src/blocks';

function DashboardBlockWithContent({
  loading = false,
  error = false,
  variant = 'default' as const,
  size = 'medium' as const,
  footer = false,
  onRetry,
}: {
  loading?: boolean;
  error?: boolean;
  variant?: 'default' | 'outlined' | 'filled';
  size?: 'small' | 'medium' | 'large';
  footer?: boolean;
  onRetry?: () => void;
}) {
  return (
    <DashboardBlock
      title="Revenue Overview"
      collapsible
      loading={loading}
      error={error}
      errorConfig={{
        message: 'Failed to load data',
        onRetry: onRetry,
      }}
      variant={variant}
      size={size}
      footer={footer ? <Button size="small">View All</Button> : undefined}
    >
      <Box sx={{ p: 2 }}>
        <Typography variant="h3">$125,000</Typography>
        <Typography color="text.secondary">Total revenue this month</Typography>
      </Box>
    </DashboardBlock>
  );
}

function DashboardBlockWithHook() {
  const { state, actions, blockProps } = useDashboardBlock();

  return (
    <Box>
      <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
        <Button variant="outlined" onClick={actions.toggleCollapse}>
          External Toggle
        </Button>
        <Typography data-testid="collapse-state">{state.collapsed ? 'collapsed' : 'expanded'}</Typography>
      </Box>
      <DashboardBlock title="Controlled Block" collapsible {...blockProps}>
        <Box sx={{ p: 2 }}>
          <Typography>Content controlled by hook</Typography>
        </Box>
      </DashboardBlock>
    </Box>
  );
}

export function DashboardBlockTestPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const loading = searchParams.get('loading') === 'true';
  const error = searchParams.get('error') === 'true';
  const variant = (searchParams.get('variant') as 'default' | 'outlined' | 'filled') || 'default';
  const size = (searchParams.get('size') as 'small' | 'medium' | 'large') || 'medium';
  const footer = searchParams.get('footer') === 'true';
  const useHook = searchParams.get('useHook') === 'true';
  const retryCount = parseInt(searchParams.get('retry') || '0', 10);

  const handleRetry = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('retry', String(retryCount + 1));
    navigate(`/test/dashboard-block?${newParams.toString()}`);
  };

  if (useHook) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          DashboardBlock with Hook
        </Typography>
        <DashboardBlockWithHook />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        DashboardBlock Test Page
      </Typography>
      <DashboardBlockWithContent
        loading={loading}
        error={error}
        variant={variant}
        size={size}
        footer={footer}
        onRetry={handleRetry}
      />
    </Box>
  );
}
