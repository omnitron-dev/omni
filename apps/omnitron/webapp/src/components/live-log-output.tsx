import { useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';

/** Keep the reader's place even when the server rolls its bounded tail forward. */
export function LiveLogOutput({ label, text, live, onPause }: {
  label: string; text: string; live: boolean; onPause?: () => void;
}) {
  const viewport = useRef<HTMLPreElement>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const paused = snapshot !== null;
  const following = useRef(live);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (el && !paused && (following.current || live)) el.scrollTop = el.scrollHeight;
    following.current = live;
  }, [text, live, paused]);

  const pause = () => {
    if (!live || paused) return;
    onPause?.();
    setSnapshot(text);
  };
  return <Stack spacing={0.5} sx={{ minWidth: 0 }}>
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      {(live || paused) && <Button size="small" aria-label={(paused ? 'Resume ' : 'Pause ') + label}
        onClick={() => {
          if (!paused) { pause(); return; }
          following.current = true;
          setSnapshot(null);
        }}>{paused ? 'Resume updates' : 'Pause updates'}</Button>}
    </Stack>
    <Box component="pre" ref={viewport} tabIndex={0} aria-label={label}
      onScroll={event => {
        const el = event.currentTarget;
        if (el.scrollTop + el.clientHeight < el.scrollHeight - 8) pause();
      }}
      sx={{ m: 0, px: 1.5, py: 1.25, border: 1, borderColor: 'divider', borderRadius: 1,
        bgcolor: 'action.hover', fontFamily: 'monospace', fontSize: '0.78rem', lineHeight: 1.65, maxHeight: 340,
        minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflow: 'auto', overscrollBehavior: 'contain' }}>
      {snapshot ?? text}
    </Box>
  </Stack>;
}
