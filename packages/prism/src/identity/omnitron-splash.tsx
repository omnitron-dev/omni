'use client';

import { useId, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { OmnitronMark, type OmnitronMarkState } from './omnitron-mark.js';
import { omnitronTokens } from './tokens.js';

export interface OmnitronSplashProps {
  state?: Exclude<OmnitronMarkState, 'idle'>;
  message?: string;
  /** Actual measured completion only. Omit when the operation has no total. */
  progress?: number;
  action?: ReactNode;
  fullScreen?: boolean;
  sx?: SxProps<Theme>;
}

/** Honest loading, completion and failure states using the same identity as navigation. */
export function OmnitronSplash({ state = 'loading', message, progress, action, fullScreen = false, sx }: OmnitronSplashProps) {
  const messageId = useId();
  const value = state === 'loading' && progress !== undefined && Number.isFinite(progress)
    ? Math.min(100, Math.max(0, progress)) : undefined;
  const text = message ?? (state === 'error' ? 'Unable to continue' : state === 'success' ? 'Ready' : 'Loading…');

  return (
    <Box data-omnitron-splash={state} sx={[
      {
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 2, p: 3, width: '100%', minWidth: 0, minHeight: 200, flexGrow: 1,
        ...(fullScreen && { position: 'fixed', inset: 0, zIndex: (theme: Theme) => theme.zIndex.modal + 1, bgcolor: 'background.default' }),
      },
      ...(Array.isArray(sx) ? sx : [sx]),
    ]}>
      <OmnitronMark size={72} state={state} label={null} />
      <Typography id={messageId} role={state === 'error' ? 'alert' : 'status'} variant="body2" sx={{ color: state === 'error' ? 'error.main' : 'text.secondary', textAlign: 'center', maxWidth: 420, overflowWrap: 'anywhere' }}>
        {text}
      </Typography>
      {value !== undefined && (
        <Box sx={{ width: '100%', maxWidth: 240 }}>
          <LinearProgress aria-labelledby={messageId} variant="determinate" value={value} sx={{ height: 2, borderRadius: 0, '@media (prefers-reduced-motion: reduce)': { '& .MuiLinearProgress-bar': { transition: 'none' } } }} />
          <Typography component="div" variant="caption" sx={{ mt: 1, color: 'text.secondary', textAlign: 'center', fontFamily: omnitronTokens.font.mono, fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(value)}%
          </Typography>
        </Box>
      )}
      {action}
    </Box>
  );
}
