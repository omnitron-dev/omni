'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { keyframes, type SxProps, type Theme } from '@mui/material/styles';
import { omnitronMarkGeometry } from './geometry.js';
import { omnitronTokens } from './tokens.js';

export type OmnitronMarkState = 'idle' | 'loading' | 'success' | 'error';

export interface OmnitronMarkProps {
  size?: number;
  state?: OmnitronMarkState;
  /** Null when adjacent text already names the brand or operation. */
  label?: string | null;
  sx?: SxProps<Theme>;
}

const reflect = keyframes`
  0%, 60%, 100% { transform: translate(0, 0); }
  20%, 38% { transform: translate(var(--omni-shift-x), var(--omni-shift-y)); }
`;

/** A static identity first; activity moves only the three outer facets. */
export function OmnitronMark({ size = 32, state = 'idle', label = 'Omnitron', sx }: OmnitronMarkProps) {
  const titleId = useId();
  const ref = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(true);
  const loading = state === 'loading';

  useEffect(() => {
    if (!loading) return undefined;
    let intersecting = true;
    const update = () => setVisible(intersecting && !document.hidden);
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? false;
      update();
    });
    if (ref.current) observer?.observe(ref.current);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [loading]);

  return (
    <Box
      ref={ref}
      component="svg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={omnitronMarkGeometry.viewBox}
      role={label ? 'img' : undefined}
      aria-labelledby={label ? titleId : undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-omnitron-mark={state}
      sx={[
        {
          display: 'block', width: size, height: size, flexShrink: 0,
          color: state === 'error' ? 'error.main' : state === 'success' ? 'success.main' : 'primary.main',
          fill: 'currentColor',
          '& [data-facet]': loading ? {
            animation: `${reflect} 2.4s ease-in-out infinite`,
            animationPlayState: visible ? 'running' : 'paused',
            '@media (prefers-reduced-motion: reduce)': { animation: 'none', transform: 'none' },
          } : {},
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {label && <title id={titleId}>{label}</title>}
      {omnitronMarkGeometry.facets.map(({ path, x, y }, index) => (
        <path key={path} data-facet={index} d={path} style={{
          '--omni-shift-x': `${x}px`, '--omni-shift-y': `${y}px`, animationDelay: `${index * 160}ms`,
        } as CSSProperties} />
      ))}
      {state === 'success' ? (
        <path d="m28 35 3 2.5 5.5-4.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : state === 'error' ? (
        <path d="m29 32 7 6m0-6-7 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      ) : <path d={omnitronMarkGeometry.core} />}
    </Box>
  );
}

/** Text stays text: it scales, translates through assistive tools, and remains crisp. */
export function OmnitronBrand({ size = 32, sx }: Pick<OmnitronMarkProps, 'size' | 'sx'>) {
  return (
    <Box sx={[{ display: 'inline-flex', alignItems: 'center', gap: 1.25, minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <OmnitronMark size={size} label={null} />
      <Typography component="span" sx={{ fontFamily: omnitronTokens.font.sans, color: 'text.primary', fontWeight: 600, fontSize: '0.875rem', letterSpacing: '0.12em', lineHeight: 1, whiteSpace: 'nowrap' }}>
        OMNITRON
      </Typography>
    </Box>
  );
}
