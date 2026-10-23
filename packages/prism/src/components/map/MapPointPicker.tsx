'use client';

import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { Stack, Paper, Typography, CircularProgress, Box, Button, Alert } from '@mui/material';
import { Map } from './Map.js';
import type { MapProps, MapViewport } from './Map.js';
import { isMapPoint, normalizeMapPoint, mapCameraLatitude } from './coordinates.js';
import type { MapPointPickerValue } from './coordinates.js';
export type { MapPointPickerValue } from './coordinates.js';

export interface MapPointPickerLabels {
  placeholder: string;
  coordinates: string;
  place: string;
  loading: string;
  unknown: string;
  chooseCenter: string;
  clear: string;
  marker: string;
}
const defaults: MapPointPickerLabels = {
  placeholder: 'Choose a point on the map, or move the map and select its centre.',
  coordinates: 'Coordinates',
  place: 'Place',
  loading: 'Finding place…',
  unknown: 'No place name for this point',
  chooseCenter: 'Select map centre',
  clear: 'Clear selection',
  marker: 'Selected point',
};
export interface MapPointPickerProps {
  value: MapPointPickerValue | null;
  onChange: (next: MapPointPickerValue) => void;
  onClear?: () => void;
  initialViewport?: Partial<MapViewport>;
  /** Minimum zoom when receiving a newly selected point. */
  selectionZoom?: number;
  styleUrl?: MapProps['styleUrl'];
  height?: number;
  geocodeResult?: ReactNode;
  geocodeLoading?: boolean;
  geocodeError?: ReactNode;
  placeholder?: string;
  labels?: Partial<MapPointPickerLabels>;
  readOnly?: boolean;
  showDetails?: boolean;
  /** MapLibre sources, overlays and interaction configuration are reusable. */
  mapProps?: Omit<MapProps, 'viewport' | 'onViewportChange' | 'onClick' | 'styleUrl' | 'initialViewport'>;
}
export function MapPointPicker({
  value,
  onChange,
  onClear,
  initialViewport,
  selectionZoom = 10,
  styleUrl,
  height = 480,
  geocodeResult,
  geocodeLoading = false,
  geocodeError,
  placeholder,
  labels,
  readOnly = false,
  showDetails = true,
  mapProps,
}: MapPointPickerProps) {
  const copy = { ...defaults, ...labels, ...(placeholder ? { placeholder } : {}) };
  const valid = value && isMapPoint(value) ? value : null;
  const [camera, setCamera] = useState<MapViewport>(() => ({
    longitude: valid?.lng ?? 0,
    latitude: valid ? mapCameraLatitude(valid.lat) : 0,
    zoom: valid ? 10 : 1,
    ...initialViewport,
  }));
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (value && isMapPoint(value))
      setCamera((old) => ({
        ...old,
        longitude: value.lng,
        latitude: mapCameraLatitude(value.lat),
        zoom: Math.max(old.zoom, selectionZoom),
      }));
  }, [value?.lng, value?.lat, selectionZoom]);
  function choose(lng: number, lat: number) {
    const point = normalizeMapPoint(lng, lat);
    if (point && !readOnly) onChange(point);
  }
  return (
    <Stack sx={{ gap: 2, width: '100%' }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: showDetails ? { xs: '1fr', md: 'minmax(0,1fr) 280px' } : '1fr',
          gap: 2,
        }}
      >
        <Map
          {...mapProps}
          styleUrl={styleUrl}
          viewport={camera}
          onViewportChange={setCamera}
          cursor={readOnly ? 'grab' : 'crosshair'}
          onClick={(event) => choose(event.lngLat.lng, event.lngLat.lat)}
          onLoad={(event) => {
            setLoaded(true);
            mapProps?.onLoad?.(event);
          }}
          style={{ ...mapProps?.style, height }}
        >
          {mapProps?.children}
          {valid && (
            <Marker
              longitude={valid.lng}
              latitude={valid.lat}
              anchor="center"
              draggable={!readOnly}
              onDragEnd={(event) => choose(event.lngLat.lng, event.lngLat.lat)}
            >
              <Box
                role="img"
                aria-label={copy.marker}
                sx={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  border: '3px solid',
                  borderColor: 'background.paper',
                  boxShadow: 2,
                }}
              />
            </Marker>
          )}
        </Map>
        {showDetails && (
          <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
            {valid ? (
              <Stack sx={{ gap: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {copy.coordinates}
                </Typography>
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {valid.lat.toFixed(5)}, {valid.lng.toFixed(5)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {copy.place}
                </Typography>
                {geocodeLoading ? (
                  <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }} role="status">
                    <CircularProgress size={16} />
                    <Typography variant="body2">{copy.loading}</Typography>
                  </Stack>
                ) : geocodeError ? (
                  <Alert severity="warning">{geocodeError}</Alert>
                ) : (
                  <Box sx={{ overflowWrap: 'anywhere' }}>
                    {geocodeResult ?? (
                      <Typography variant="body2" color="text.secondary">
                        {copy.unknown}
                      </Typography>
                    )}
                  </Box>
                )}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {copy.placeholder}
              </Typography>
            )}
          </Paper>
        )}
      </Box>
      {!readOnly && (
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button type="button" disabled={!loaded} onClick={() => choose(camera.longitude, camera.latitude)}>
            {copy.chooseCenter}
          </Button>
          {onClear && (
            <Button type="button" disabled={!value} onClick={onClear}>
              {copy.clear}
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
}
