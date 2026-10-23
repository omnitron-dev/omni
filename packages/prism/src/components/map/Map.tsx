'use client';

import './map.css';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Alert, Box, LinearProgress } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Map as ReactMapGL, NavigationControl, ScaleControl } from 'react-map-gl/maplibre';
import type { MapProps as EngineProps, MapRef } from 'react-map-gl/maplibre';
import { addProtocol } from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';

// Register before creating a map; style loading can begin before parent effects.
// PMTiles maintains its own bounded archive/directory cache. Map instances do not
// remove this shared protocol when another instance might still be using it.
const protocol = new Protocol();
addProtocol('pmtiles', protocol.tile);

export interface MapViewport {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
}
export type MapStyle = string | StyleSpecification;
export interface MapMessages {
  label: string;
  missingStyle: string;
  loading: string;
  error: string;
}
const messages: MapMessages = {
  label: 'Interactive map',
  missingStyle: 'A map source has not been configured.',
  loading: 'Loading map',
  error: 'Some map data could not be loaded. Check the connection or map source.',
};
export interface MapProps extends Omit<EngineProps, 'mapStyle' | 'style' | 'children'> {
  /** Explicit style, or legacy host-injected window.__MAP_STYLE_URL__. No public fallback. */
  styleUrl?: MapStyle;
  /** Separate complete styles; selecting a theme does not rewrite provider layers. */
  styles?: { light: MapStyle; dark: MapStyle };
  viewport?: Partial<MapViewport>;
  initialViewport?: Partial<MapViewport>;
  onViewportChange?: (next: MapViewport) => void;
  showNavigation?: boolean;
  showScale?: boolean;
  showAttribution?: boolean;
  style?: CSSProperties;
  messages?: Partial<MapMessages>;
  children?: ReactNode;
}
const world: MapViewport = { longitude: 0, latitude: 0, zoom: 1, bearing: 0, pitch: 0 };

/** Provider-neutral MapLibre surface. Sources/layers/events remain fully typed. */
export const Map = forwardRef<MapRef, MapProps>(function MapView(
  {
    styleUrl,
    styles,
    viewport,
    initialViewport,
    onViewportChange,
    showNavigation = true,
    showScale = true,
    showAttribution = true,
    style,
    messages: overrides,
    children,
    onMove,
    onLoad,
    onError,
    cooperativeGestures = true,
    ...engine
  },
  forwardedRef
) {
  const theme = useTheme();
  const copy = { ...messages, ...overrides };
  const legacyStyle =
    typeof window !== 'undefined' ? (window as Window & { __MAP_STYLE_URL__?: string }).__MAP_STYLE_URL__ : undefined;
  const mapStyle = styleUrl ?? styles?.[theme.palette.mode] ?? legacyStyle;
  const initial = { ...world, ...initialViewport };
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapRef | null>(null);
  const [readyStyle, setReadyStyle] = useState<MapStyle>();
  const [error, setError] = useState(false);
  const setMap = useCallback(
    (value: MapRef | null) => {
      map.current = value;
      if (typeof forwardedRef === 'function') forwardedRef(value);
      else if (forwardedRef) forwardedRef.current = value;
    },
    [forwardedRef]
  );
  useEffect(() => {
    if (!host.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setError(false), [mapStyle]);
  return (
    <Box
      ref={host}
      role="region"
      aria-label={copy.label}
      style={style}
      sx={{
        width: '100%',
        height: 400,
        position: 'relative',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        '& .maplibregl-ctrl-group, & .maplibregl-popup-content': {
          bgcolor: 'background.paper',
          color: 'text.primary',
          boxShadow: theme.shadows[2],
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
        },
        '& .maplibregl-ctrl-group button': { color: 'text.primary', borderColor: 'divider' },
        '& .maplibregl-ctrl-icon': { filter: theme.palette.mode === 'dark' ? 'invert(1)' : 'none' },
        '& .maplibregl-ctrl-attrib': { bgcolor: 'background.paper', color: 'text.secondary' },
        '& .maplibregl-ctrl-attrib a': { color: 'inherit' },
        '& .maplibregl-ctrl-scale': {
          bgcolor: 'background.paper',
          color: 'text.primary',
          borderColor: 'text.secondary',
        },
        '& .maplibregl-ctrl button:focus-visible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: -2,
        },
      }}
    >
      {!mapStyle ? (
        <Alert severity="info" sx={{ m: 2 }}>
          {copy.missingStyle}
        </Alert>
      ) : (
        <>
          <ReactMapGL
            {...engine}
            ref={setMap}
            mapStyle={mapStyle}
            cooperativeGestures={cooperativeGestures}
            {...(viewport
              ? { ...initial, ...viewport }
              : {
                  initialViewState: initial,
                  ...(engine.initialViewState ? { initialViewState: engine.initialViewState } : {}),
                })}
            onMove={(event) => {
              onViewportChange?.(event.viewState);
              onMove?.(event);
            }}
            onLoad={(event) => {
              setReadyStyle(mapStyle);
              onLoad?.(event);
            }}
            onIdle={(event) => {
              setReadyStyle(mapStyle);
              engine.onIdle?.(event);
            }}
            onError={(event) => {
              setError(true);
              onError?.(event);
            }}
            attributionControl={showAttribution ? (engine.attributionControl ?? {}) : false}
            style={{ width: '100%', height: '100%' }}
          >
            {showNavigation && <NavigationControl position="top-right" />}
            {showScale && <ScaleControl position="bottom-left" />}
            {children}
          </ReactMapGL>
          {readyStyle !== mapStyle && !error && (
            <LinearProgress aria-label={copy.loading} sx={{ position: 'absolute', top: 0, left: 0, right: 0 }} />
          )}
          {error && (
            <Alert
              severity="warning"
              onClose={() => setError(false)}
              sx={{ position: 'absolute', left: 8, right: 8, top: 8 }}
            >
              {copy.error}
            </Alert>
          )}
        </>
      )}
    </Box>
  );
});
