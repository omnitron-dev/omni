import { useEffect, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';

/** Feedback for a real in-flight operation; elapsed time is never a completion percentage. */
export function OperationStatus({ active, label, detail }: { active: boolean; label: string; detail?: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (!active) return undefined;
    const start = performance.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((performance.now() - start) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active, label]);
  if (!active) return null;
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', minWidth: 0, py: 1 }}
    >
      <CircularProgress
        size={16}
        thickness={4}
        aria-hidden
        sx={{ flexShrink: 0, mt: '3px', '@media (prefers-reduced-motion: reduce)': { animation: 'none', '& circle': { animation: 'none' } } }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          {label}
        </Typography>
        {detail && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
            {detail}
          </Typography>
        )}
        {seconds >= 10 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Still waiting for confirmation…
          </Typography>
        )}
      </Box>
      <Typography
        aria-hidden
        variant="caption"
        color="text.secondary"
        sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap', pt: '2px', fontVariantNumeric: 'tabular-nums' }}
      >
        {seconds}s
      </Typography>
    </Box>
  );
}
