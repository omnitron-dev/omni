'use client';

/**
 * MapCoverageLayer Component
 *
 * Renders an array of typed points on the parent `<Map>` as
 * colour-coded circles. Designed for "coverage" use cases
 * (dead-drops by status, pickup points by enabled/disabled,
 * shops by tier). Uses a single MapLibre symbol layer driven by
 * an in-memory GeoJSON source so rendering scales to a few
 * thousand points without DOM thrash.
 *
 * For < ~200 points, prefer composing `<MapMarker>` directly —
 * it gives you click + popup affordances per marker. This layer
 * is for the "show me the whole network" view.
 *
 * @module @omnitron-dev/prism/components/map
 */

import { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useTheme } from '@mui/material/styles';

export interface CoveragePoint {
  /** Unique id within the layer; used as feature id for clicks. */
  id: string;
  longitude: number;
  latitude: number;
  /** Free-form bucket; the layer maps it to a colour via
   *  the `colorByStatus` prop. Default mapping covers the
   *  generic 'active'/'pending'/'expired'/'disabled' buckets. */
  status?: string;
  /** Optional label shown next to the point when zoomed in. */
  label?: string;
}

export interface MapCoverageLayerProps {
  id: string;
  points: CoveragePoint[];
  /** Map of status → colour. Override to project custom domain
   *  semantics. Default uses theme palette. */
  colorByStatus?: Record<string, string>;
  /** Marker radius in pixels (zoom-stable). Default 6. */
  radius?: number;
  /** Show label text alongside each marker (zoom 12+). */
  showLabels?: boolean;
}

export function MapCoverageLayer({
  id,
  points,
  colorByStatus,
  radius = 6,
  showLabels = false,
}: MapCoverageLayerProps) {
  const theme = useTheme();

  const palette = useMemo<Record<string, string>>(
    () => ({
      active: theme.palette.success.main,
      pending: theme.palette.warning.main,
      expired: theme.palette.text.disabled,
      disabled: theme.palette.text.disabled,
      retired: theme.palette.text.disabled,
      ...(colorByStatus ?? {}),
    }),
    [theme, colorByStatus],
  );

  const geojson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: points.map((p) => ({
        type: 'Feature' as const,
        id: p.id,
        geometry: {
          type: 'Point' as const,
          coordinates: [p.longitude, p.latitude],
        },
        properties: {
          status: p.status ?? 'active',
          label: p.label ?? '',
          color: palette[p.status ?? 'active'] ?? theme.palette.primary.main,
        },
      })),
    }),
    [points, palette, theme],
  );

  return (
    <Source id={id} type="geojson" data={geojson}>
      <Layer
        id={`${id}-circles`}
        type="circle"
        paint={{
          'circle-radius': radius,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': theme.palette.background.paper,
          'circle-stroke-width': 1.5,
        }}
      />
      {showLabels && (
        <Layer
          id={`${id}-labels`}
          type="symbol"
          minzoom={11}
          layout={{
            'text-field': ['get', 'label'],
            'text-size': 11,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
            'text-font': ['Noto Sans Regular'],
          }}
          paint={{
            'text-color': theme.palette.text.primary,
            'text-halo-color': theme.palette.background.paper,
            'text-halo-width': 1,
          }}
        />
      )}
    </Source>
  );
}
