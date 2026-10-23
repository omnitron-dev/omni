'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Autocomplete, Box, Button, CircularProgress, TextField } from '@mui/material';
import { isMapPoint } from './coordinates.js';
import type { MapPointPickerValue } from './coordinates.js';

export interface MapPlace {
  /** Provider-stable identifier, qualified with the provider name. */
  id: string;
  label: string;
  point: MapPointPickerValue;
}
export interface MapPlaceSearchLabels {
  label: string;
  search: string;
  clear: string;
  loading: string;
  empty: string;
  hint: string;
  error: string;
}
const defaults: MapPlaceSearchLabels = {
  label: 'Find a place',
  search: 'Search',
  clear: 'Clear',
  loading: 'Searching…',
  empty: 'No places found',
  hint: 'Enter a place and search',
  error: 'Place search is unavailable. Try again.',
};
export interface MapPlaceSearchProps<T extends MapPlace = MapPlace> {
  /** Supply a Netron/API adapter. Prism makes no requests to a provider itself. */
  search: (query: string, options: { signal: AbortSignal; limit: number }) => Promise<readonly T[]>;
  onSelect: (place: T) => void;
  /** Explicit submission works with every geocoder; autocomplete must be provider-supported. */
  mode?: 'submit' | 'autocomplete';
  debounceMs?: number;
  minLength?: number;
  limit?: number;
  disabled?: boolean;
  labels?: Partial<MapPlaceSearchLabels>;
}
export function MapPlaceSearch<T extends MapPlace>({
  search,
  onSelect,
  mode = 'submit',
  debounceMs = 300,
  minLength = 2,
  limit = 8,
  disabled = false,
  labels,
}: MapPlaceSearchProps<T>) {
  const copy = { ...defaults, ...labels };
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [selected, setSelected] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const generation = useRef(0),
    active = useRef<AbortController | null>(null);
  const highlighted = useRef<T | null>(null);
  const provider = useRef(search);
  provider.current = search;
  const validQuery = query.trim().length >= minLength && query.length <= 200;
  function cancel() {
    generation.current++;
    active.current?.abort();
    active.current = null;
  }
  async function run() {
    cancel();
    if (!validQuery || disabled) return;
    const id = generation.current;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError(false);
    setSearched(true);
    setOpen(true);
    try {
      const values = await provider.current(query.trim(), { signal: controller.signal, limit });
      if (id !== generation.current || controller.signal.aborted) return;
      if (!Array.isArray(values) || values.some((v) => !v || !v.id || !v.label || !v.point || !isMapPoint(v.point)))
        throw new Error('Invalid geocoder response');
      const ids = new Set<string>();
      setResults(
        values
          .filter((v) => {
            if (ids.has(v.id)) return false;
            ids.add(v.id);
            return true;
          })
          .slice(0, limit)
      );
    } catch {
      if (id === generation.current && !controller.signal.aborted) {
        setError(true);
        setResults([]);
        setOpen(false);
      }
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (mode !== 'autocomplete' || !validQuery || disabled || selected) return;
    const timer = setTimeout(() => void run(), debounceMs);
    return () => clearTimeout(timer);
  }, [query, mode, debounceMs, disabled, selected]);
  useEffect(() => {
    if (disabled) {
      cancel();
      setLoading(false);
      setOpen(false);
    }
  }, [disabled]);
  useEffect(() => () => cancel(), []);
  function input(value: string) {
    cancel();
    setQuery(value);
    setSelected(null);
    setResults([]);
    setError(false);
    setLoading(false);
    setSearched(false);
    highlighted.current = null;
  }
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Autocomplete<T, false, false, false>
          sx={{ flex: 1, minWidth: 0 }}
          disabled={disabled}
          options={results}
          value={selected}
          inputValue={query}
          open={open}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          onInputChange={(_, value, reason) => {
            if (reason === 'input' || reason === 'clear') input(value);
          }}
          onChange={(_, place) => {
            if (place) {
              cancel();
              setLoading(false);
              setSelected(place);
              setQuery(place.label);
              setOpen(false);
              onSelect(place);
            }
          }}
          onHighlightChange={(_, option) => {
            highlighted.current = option;
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (!highlighted.current) {
              (event as typeof event & { defaultMuiPrevented: boolean }).defaultMuiPrevented = true;
              void run();
            }
          }}
          getOptionLabel={(place) => place.label}
          getOptionKey={(place) => place.id}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          filterOptions={(options) => options}
          loading={loading}
          loadingText={copy.loading}
          clearText={copy.clear}
          noOptionsText={searched ? copy.empty : copy.hint}
          forcePopupIcon={false}
          renderInput={(params) => (
            <TextField
              {...params}
              label={copy.label}
              slotProps={{
                ...params.slotProps,
                htmlInput: { ...params.slotProps.htmlInput, maxLength: 200 },
                input: {
                  ...params.slotProps.input,
                  endAdornment: (
                    <>
                      {loading && <CircularProgress color="inherit" size={18} />}
                      {params.slotProps.input.endAdornment}
                    </>
                  ),
                },
              }}
            />
          )}
        />
        {mode === 'submit' && (
          <Button
            type="button"
            variant="outlined"
            disabled={disabled || loading || !validQuery}
            onClick={() => void run()}
            sx={{ minHeight: 40 }}
          >
            {copy.search}
          </Button>
        )}
      </Box>
      {error && <Alert severity="warning">{copy.error}</Alert>}
    </Box>
  );
}
