/**
 * Standalone <Emoji> renderer — used everywhere a single emoji is
 * displayed outside the picker (reaction chips, message content,
 * etc.). Two visual modes:
 *
 *   - `set="native"` — render the unicode glyph as text. Cheapest,
 *     but the visual style depends on the OS font.
 *   - `set="twitter"` — render a twemoji SVG from the jsdelivr CDN.
 *     Consistent cross-platform look, one HTTP/2 request per unique
 *     emoji (browser-cached). Falls back to native rendering when
 *     the SVG fails to load.
 *
 * The component is intentionally tiny and stateless so it can sit
 * inside hot rendering paths (every reaction chip, every chat
 * bubble) without measurable cost.
 */

import { useState } from 'react';
import Box from '@mui/material/Box';
import { twemojiUrlFromNative } from './twemoji-url.js';
import type { EmojiProps } from './types.js';

export function Emoji({ native, set = 'twitter', size, alt }: EmojiProps) {
  const [failed, setFailed] = useState(false);

  // Native rendering — or twitter mode after the SVG failed to load.
  if (set === 'native' || failed) {
    return (
      <Box
        component="span"
        role="img"
        aria-label={alt ?? native}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
          fontSize: size ? `${size}px` : 'inherit',
          fontFamily:
            '"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji",EmojiOne,sans-serif',
        }}
      >
        {native}
      </Box>
    );
  }

  return (
    <Box
      component="img"
      src={twemojiUrlFromNative(native)}
      alt={alt ?? native}
      draggable={false}
      onError={() => setFailed(true)}
      sx={{
        display: 'inline-block',
        verticalAlign: 'text-bottom',
        width: size ? `${size}px` : '1em',
        height: size ? `${size}px` : '1em',
        userSelect: 'none',
      }}
    />
  );
}
