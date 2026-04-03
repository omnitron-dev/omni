'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { useScrollSpy } from './scroll-spy-provider';

interface ScrollSpySectionProps {
  id: string;
  children: ReactNode;
  sx?: SxProps<Theme>;
}

export function ScrollSpySection({ id, children, sx }: ScrollSpySectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { registerSection, unregisterSection } = useScrollSpy();

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    registerSection(id, element);
    return () => unregisterSection(id);
  }, [id, registerSection, unregisterSection]);

  return (
    <Box ref={ref} id={id} sx={sx}>
      {children}
    </Box>
  );
}
