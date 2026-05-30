'use client';

/**
 * MapMarker Component
 *
 * Decorative marker pinned at `[longitude, latitude]` on the
 * parent `<Map>`. Renders a HugeIcons-styled pin by default;
 * pass `children` for a fully custom marker DOM. Optional
 * `popup` opens a Popup on click.
 *
 * @module @omnitron-dev/prism/components/map
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Marker, Popup } from 'react-map-gl/maplibre';
import { useTheme } from '@mui/material/styles';

export interface MapMarkerProps {
  longitude: number;
  latitude: number;
  /** Marker fill colour. Defaults to theme primary. */
  color?: string;
  /** Custom DOM (overrides the default pin icon). */
  children?: ReactNode;
  /** Popup body shown on click. */
  popup?: ReactNode;
  /** Anchor side. Defaults to bottom (pin tip at coordinate). */
  anchor?: 'center' | 'top' | 'bottom' | 'left' | 'right';
  /** Click-through handler. */
  onClick?: () => void;
}

export function MapMarker({
  longitude,
  latitude,
  color,
  children,
  popup,
  anchor = 'bottom',
  onClick,
}: MapMarkerProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const fill = color ?? theme.palette.primary.main;

  const handleClick = (e: { originalEvent?: { stopPropagation?: () => void } }) => {
    e.originalEvent?.stopPropagation?.();
    if (popup) setOpen((v) => !v);
    onClick?.();
  };

  return (
    <>
      <Marker
        longitude={longitude}
        latitude={latitude}
        anchor={anchor}
        onClick={handleClick}
      >
        {children ?? (
          <svg width="24" height="32" viewBox="0 0 24 32" aria-hidden style={{ display: 'block' }}>
            <path
              d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z"
              fill={fill}
            />
            <circle cx="12" cy="12" r="4" fill="#fff" />
          </svg>
        )}
      </Marker>
      {popup && open && (
        <Popup
          longitude={longitude}
          latitude={latitude}
          anchor="top"
          offset={[0, -32]}
          closeOnClick={false}
          onClose={() => setOpen(false)}
        >
          {popup}
        </Popup>
      )}
    </>
  );
}
