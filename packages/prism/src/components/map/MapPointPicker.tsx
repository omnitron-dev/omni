'use client';

/**
 * MapPointPicker Component
 *
 * Controlled "click to choose a coordinate" widget. Renders a
 * `<Map>` with click handler that emits `{lng, lat}` and shows
 * a draggable `<MapMarker>` at the current value. Reverse-
 * geocoding is the host app's job (it knows which RPC client to
 * call) — pass `geocodeResult` + `geocodeLoading` from your
 * useQuery and we render them in the side panel.
 *
 * The component stays UI-only / backend-agnostic so prism has no
 * dependency on any specific RPC client. Apps wire
 * `Geocoding.reverse` to `value` changes via TanStack Query.
 *
 * @module @omnitron-dev/prism/components/map
 */

import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import type { MarkerDragEvent } from 'react-map-gl/maplibre';
import { Stack, Paper, Typography, CircularProgress, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Map } from './Map.js';
import type { MapProps, MapViewport } from './Map.js';

export interface MapPointPickerValue {
  lng: number;
  lat: number;
}

export interface MapPointPickerProps {
  /** Currently picked point, or null if nothing yet. */
  value: MapPointPickerValue | null;
  /** Called on click and on marker drag-end. */
  onChange: (next: MapPointPickerValue) => void;
  /** Initial map viewport. Default Moscow at zoom 4. */
  initialViewport?: Partial<MapViewport>;
  /** Override map tile style. */
  styleUrl?: MapProps['styleUrl'];
  /** Container height (passed to inner Map). */
  height?: number;
  /** Reverse-geocode response to display in the side panel. */
  geocodeResult?: ReactNode;
  /** Show a spinner in the side panel while host RPC is in flight. */
  geocodeLoading?: boolean;
  /** Hint text shown when value is null. */
  placeholder?: string;
}

export function MapPointPicker({
  value,
  onChange,
  initialViewport,
  styleUrl,
  height = 480,
  geocodeResult,
  geocodeLoading = false,
  placeholder = 'Кликните по карте, чтобы выбрать точку',
}: MapPointPickerProps) {
  const theme = useTheme();

  const handleClick = useCallback<NonNullable<MapProps['onClick']>>(
    (e) => onChange({ lng: e.lngLat.lng, lat: e.lngLat.lat }),
    [onChange],
  );

  const handleDragEnd = useCallback(
    (e: MarkerDragEvent) => {
      onChange({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    },
    [onChange],
  );

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ width: '100%' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Map
          styleUrl={styleUrl}
          initialViewport={initialViewport}
          cursor="crosshair"
          onClick={handleClick}
          style={{ height }}
        >
          {value && (
            <Marker
              longitude={value.lng}
              latitude={value.lat}
              anchor="bottom"
              draggable
              onDragEnd={handleDragEnd}
            >
              <svg width="24" height="32" viewBox="0 0 24 32" aria-hidden style={{ display: 'block' }}>
                <path
                  d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z"
                  fill={theme.palette.error.main}
                />
                <circle cx="12" cy="12" r="4" fill="#fff" />
              </svg>
            </Marker>
          )}
        </Map>
      </Box>
      <Paper
        variant="outlined"
        sx={{
          width: { xs: '100%', md: 320 },
          p: 2,
          borderColor: theme.palette.divider,
          bgcolor: theme.palette.background.default,
        }}
      >
        {value ? (
          <Stack spacing={1.5}>
            <Typography variant="caption" color="text.secondary">
              Координаты
            </Typography>
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Распознанное место
            </Typography>
            {geocodeLoading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  Геокодирование…
                </Typography>
              </Box>
            ) : geocodeResult ? (
              <Box>{geocodeResult}</Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Нет данных
              </Typography>
            )}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {placeholder}
          </Typography>
        )}
      </Paper>
    </Stack>
  );
}
