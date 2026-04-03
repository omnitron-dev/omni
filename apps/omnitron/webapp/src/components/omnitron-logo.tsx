/**
 * Omnitron Logo — Triangle SVG logo with gradient
 *
 * Used in sidebar nav, auth layout, and sign-in page as replacement for text "Omnitron".
 * The SVG is the official logo from apps/omnitron/logo.svg.
 */

import type { SxProps, Theme } from '@mui/material/styles';
import Box from '@mui/material/Box';

interface OmnitronLogoProps {
  /** Width in px (height auto-scales from viewBox) */
  size?: number;
  sx?: SxProps<Theme>;
}

export function OmnitronLogo({ size = 32, sx }: OmnitronLogoProps) {
  return (
    <Box
      component="svg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 210 210"
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        ...sx,
      }}
    >
      <defs>
        <linearGradient id="omni-logo-grad" x1="105" y1="165.47" x2="105" y2="52.73" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff4fff" />
          <stop offset="0.01" stopColor="#ff51fb" />
          <stop offset="0.29" stopColor="#ff75af" />
          <stop offset="0.53" stopColor="#ff9272" />
          <stop offset="0.73" stopColor="#ffa747" />
          <stop offset="0.89" stopColor="#ffb32c" />
          <stop offset="0.98" stopColor="#ffb822" />
        </linearGradient>
      </defs>
      <path
        fill="url(#omni-logo-grad)"
        d="M66.92,144.68l-27,15.59L102,52.73V83.92Zm3,5.2-27,15.59H167.09l-27-15.59Zm100.17,10.39L108,52.73V83.92l35.08,60.76Zm-34.4-16.39L105,90.72,74.31,143.88Z"
      />
    </Box>
  );
}
