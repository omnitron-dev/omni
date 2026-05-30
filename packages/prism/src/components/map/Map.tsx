'use client';

/**
 * Map Component
 *
 * Thin wrapper around `react-map-gl/maplibre` that picks up the
 * prism theme (light/dark) and ships sensible defaults
 * (NavigationControl, ScaleControl, attribution). All app-level
 * map UIs build on top of this — see `<MapMarker>`,
 * `<MapPointPicker>`, `<MapCoverageLayer>`.
 *
 * Tile source:
 *   - `styleUrl` prop OR
 *   - `MAP_STYLE_URL` browser-side env var injected by host app
 *
 * The DAOS platform is closed and Tor-friendly, so the tile
 * source MUST be self-hosted (no maptiler/mapbox CDN that would
 * leak user IPs). A fallback in-component style renders a flat
 * neutral background so the map UI is visible during local dev
 * before tile infra is set up.
 *
 * @module @omnitron-dev/prism/components/map
 */

import 'maplibre-gl/dist/maplibre-gl.css';

import { forwardRef, useEffect, useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Map as ReactMapGL, NavigationControl, ScaleControl } from 'react-map-gl/maplibre';
import type { MapRef, ViewState, ViewStateChangeEvent } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useTheme } from '@mui/material/styles';

// Register the `pmtiles://` URL scheme once per page load. The
// scheme lets a MapLibre style point at a `.pmtiles` file via
// HTTP range requests instead of a per-tile endpoint — no tile
// server process needed, the static file IS the tile server.
let pmtilesProtocolRegistered = false;
function ensurePmtilesProtocol() {
  if (pmtilesProtocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  pmtilesProtocolRegistered = true;
}

export interface MapViewport {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface MapProps {
  /** Style JSON URL (vector tile server) or inline StyleSpecification. */
  styleUrl?: string | StyleSpecification;
  /** Controlled viewport (camera). Pair with `onViewportChange` for two-way sync. */
  viewport?: Partial<MapViewport>;
  /** Defaults when `viewport` is uncontrolled or partially specified. */
  initialViewport?: Partial<MapViewport>;
  /** Callback for every camera change (drag/zoom/rotate). */
  onViewportChange?: (next: MapViewport) => void;
  /** Show NavigationControl (zoom + compass). Default: true. */
  showNavigation?: boolean;
  /** Show ScaleControl. Default: true. */
  showScale?: boolean;
  /** Show attribution. Default: true. */
  showAttribution?: boolean;
  /** Container style — pass `height` here. Default 400px height. */
  style?: CSSProperties;
  /** Cursor while idle. */
  cursor?: 'grab' | 'pointer' | 'crosshair' | string;
  /** Click handler on the map canvas. */
  onClick?: (event: { lngLat: { lng: number; lat: number } }) => void;
  /** Layer/marker children rendered inside the MapLibre canvas. */
  children?: ReactNode;
}

// Default viewport centred on Moscow at country-overview zoom —
// the platform's primary geography.
const DEFAULT_VIEWPORT: MapViewport = {
  longitude: 37.6173,
  latitude: 55.7558,
  zoom: 4,
  bearing: 0,
  pitch: 0,
};

// Minimal valid MapLibre style — solid background. Used as
// last-resort fallback so the map widget renders SOMETHING even
// when no styleUrl is configured (e.g. local dev before the tile
// server is provisioned). The fallback is deliberately ugly so
// it's obvious the tile source isn't wired up.
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#e0e0e0' },
    },
  ],
};

export const Map = forwardRef<MapRef, MapProps>(function Map(
  {
    styleUrl,
    viewport,
    initialViewport,
    onViewportChange,
    showNavigation = true,
    showScale = true,
    showAttribution = true,
    style,
    cursor = 'grab',
    onClick,
    children,
  },
  ref,
) {
  const theme = useTheme();

  // Register pmtiles:// protocol handler on first mount.
  useEffect(() => {
    ensurePmtilesProtocol();
  }, []);

  // Resolve style: explicit prop > env var (host app injects) > fallback.
  const mapStyle = useMemo<string | StyleSpecification>(() => {
    if (styleUrl) return styleUrl;
    const envUrl =
      typeof window !== 'undefined' &&
      (window as unknown as { __MAP_STYLE_URL__?: string }).__MAP_STYLE_URL__;
    if (typeof envUrl === 'string' && envUrl.length > 0) return envUrl;
    return FALLBACK_STYLE;
  }, [styleUrl]);

  const initial = useMemo<MapViewport>(
    () => ({ ...DEFAULT_VIEWPORT, ...initialViewport }),
    [initialViewport],
  );

  const handleMove = onViewportChange
    ? (e: ViewStateChangeEvent) => {
        const v: ViewState = e.viewState;
        onViewportChange({
          longitude: v.longitude,
          latitude: v.latitude,
          zoom: v.zoom,
          bearing: v.bearing,
          pitch: v.pitch,
        });
      }
    : undefined;

  const containerStyle: CSSProperties = {
    width: '100%',
    height: 400,
    borderRadius: theme.shape.borderRadius,
    overflow: 'hidden',
    ...style,
  };

  return (
    <div style={containerStyle}>
      <ReactMapGL
        ref={ref}
        mapStyle={mapStyle}
        {...(viewport
          ? {
              longitude: viewport.longitude ?? initial.longitude,
              latitude: viewport.latitude ?? initial.latitude,
              zoom: viewport.zoom ?? initial.zoom,
              bearing: viewport.bearing ?? initial.bearing,
              pitch: viewport.pitch ?? initial.pitch,
            }
          : {
              initialViewState: initial,
            })}
        onMove={handleMove}
        onClick={onClick ? (e) => onClick({ lngLat: e.lngLat }) : undefined}
        cursor={cursor}
        attributionControl={showAttribution ? {} : false}
        style={{ width: '100%', height: '100%' }}
      >
        {showNavigation && <NavigationControl position="top-right" />}
        {showScale && <ScaleControl position="bottom-left" />}
        {children}
      </ReactMapGL>
    </div>
  );
});
