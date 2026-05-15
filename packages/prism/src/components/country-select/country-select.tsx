'use client';

/**
 * CountrySelect — minimalist, localised country picker.
 *
 * Asset-free design: the consumer passes a typed `options` array
 * (Prism does not bundle the ISO 3166-1 list) and a `getFlagSrc`
 * resolver (Prism does not bundle 250+ flag SVGs). The portal supplies
 * both from its own `data/countries.ts` + `assets/countries/`, so
 * `@omnitron-dev/prism` stays under its current weight.
 *
 * The picker is Autocomplete-backed:
 *   - searchable by the visible label (locale-resolved), the iso2
 *     code, AND the alternate-locale name — typing "Russ" or "Рос"
 *     both surface the same row.
 *   - keyboard-friendly (arrow keys, Enter, Esc work natively from
 *     MUI Autocomplete).
 *   - rounded flag in the input adornment so the chosen country
 *     reads at a glance even without expanding the dropdown.
 *
 * Value contract: `value` is the lowercase iso2 code (`"ru"`, `"us"`,
 * …) or `null`. The component never returns the country object —
 * callers look up the rest from their own dictionary if needed,
 * keeping the surface narrow and JSON-serialisable for forms.
 *
 * Usage:
 *   <CountrySelect
 *     value={form.countryCode}
 *     onChange={(iso2) => form.setField('countryCode', iso2)}
 *     options={COUNTRIES}
 *     getFlagSrc={(iso2) => `/assets/countries/${iso2}.svg`}
 *     getOptionLabel={(c) => locale === 'ru' ? c.ru : c.en}
 *     label="Country"
 *   />
 */

import type { ReactNode, SyntheticEvent } from 'react';
import { useCallback, useMemo } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { TextFieldProps } from '@mui/material/TextField';
import type { AutocompleteProps } from '@mui/material/Autocomplete';

import { FlagIcon } from './flag-icon';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Generic shape the picker understands. The consumer's full Country
 * type can extend this — we only read what we need.
 *
 * `iso2` MUST be lowercase. Renderers compare and lookup by lowercase
 * throughout the picker; mixing case will quietly desynchronise the
 * selected state from the option list.
 */
export interface CountryOption {
  iso2: string;
  en: string;
  ru: string;
  /** Optional extras (iso3, phone, …) the consumer may use elsewhere. */
  [key: string]: unknown;
}

export interface CountrySelectProps {
  /** Currently selected ISO 3166-1 alpha-2 code (lowercase) or null. */
  value: string | null;
  /** Called with the new iso2 code (lowercase) or null when cleared. */
  onChange: (iso2: string | null) => void;
  /** Full country list. Consumer owns the data; Prism does not bundle. */
  options: ReadonlyArray<CountryOption>;
  /** Flag URL resolver. Receives lowercase iso2, returns absolute or relative URL. */
  getFlagSrc?: (iso2: string) => string | null | undefined;
  /**
   * Locale-aware label resolver. Defaults to the `en` field.
   * Pass `(c) => locale === 'ru' ? c.ru : c.en` from the host app's
   * i18n hook to render in the active language.
   */
  getOptionLabel?: (c: CountryOption) => string;
  /** Field label (rendered by the underlying TextField). */
  label?: string;
  /** Placeholder text. */
  placeholder?: string;
  /** Helper text below the input. */
  helperText?: ReactNode;
  /** Error state (shows the input red, helperText switches to error.main). */
  error?: boolean;
  /** Disable the field entirely. */
  disabled?: boolean;
  /** Take full width of the container. */
  fullWidth?: boolean;
  /** Compact / dense variant. */
  size?: 'small' | 'medium';
  /** Override the underlying TextField props (variant, sx, slotProps, …). */
  textFieldProps?: Partial<TextFieldProps>;
  /** Forwarded Autocomplete props for niche tweaks (sx, ListboxProps, …). */
  autocompleteProps?: Partial<
    Omit<
      AutocompleteProps<CountryOption, false, false, false>,
      'value' | 'onChange' | 'options' | 'renderInput' | 'getOptionLabel'
    >
  >;
  /**
   * Sentinel value emitted when the user picks the synthetic
   * "Worldwide" row. When set, an extra pinned row appears at the
   * top of the dropdown with a globe icon instead of a flag.
   * Use a value that cannot collide with any ISO 3166-1 alpha-2
   * code (e.g. `'world'` or `'*'`). Defaults to undefined → no row.
   */
  worldwideValue?: string;
  /**
   * Already-localised label for the worldwide row. Consumer pulls
   * this from i18n (e.g. `t('common.worldwide')`). Required when
   * `worldwideValue` is set.
   */
  worldwideLabel?: string;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function CountrySelect({
  value,
  onChange,
  options,
  getFlagSrc,
  getOptionLabel,
  label,
  placeholder,
  helperText,
  error,
  disabled,
  fullWidth = true,
  size = 'small',
  textFieldProps,
  autocompleteProps,
  worldwideValue,
  worldwideLabel,
}: CountrySelectProps): ReactNode {
  // Resolve the visible label per option. Defaults to `en` so the
  // picker still renders something sensible when the host app forgets
  // to pass `getOptionLabel`.
  const label_ = useCallback(
    (c: CountryOption) => {
      // Synthetic worldwide row carries its localised label directly
      // in the `en` field (we mirror it into `ru` too, see below).
      if (worldwideValue && c.iso2 === worldwideValue) {
        return worldwideLabel ?? c.en;
      }
      return getOptionLabel ? getOptionLabel(c) : c.en;
    },
    [getOptionLabel, worldwideValue, worldwideLabel],
  );

  // Build the option set. When `worldwideValue` is set, prepend a
  // synthetic row so it sits at the top of the dropdown. We use a
  // pseudo iso2 that the consumer controls (e.g. `'world'`) so it
  // never collides with real ISO codes.
  const optionsWithWorld = useMemo(() => {
    if (!worldwideValue) return options as CountryOption[];
    const synthetic: CountryOption = {
      iso2: worldwideValue,
      en: worldwideLabel ?? 'Worldwide',
      ru: worldwideLabel ?? 'Worldwide',
    };
    return [synthetic, ...options];
  }, [options, worldwideValue, worldwideLabel]);

  // Lookup map for O(1) value→option resolution. Recomputed when the
  // `options` reference changes — callers should memoise the array
  // so this map stays stable.
  const byIso2 = useMemo(() => {
    const map = new Map<string, CountryOption>();
    for (const o of optionsWithWorld) map.set(o.iso2.toLowerCase(), o);
    return map;
  }, [optionsWithWorld]);

  const selected = value ? byIso2.get(value.toLowerCase()) ?? null : null;
  const isWorld = !!(worldwideValue && selected && selected.iso2 === worldwideValue);

  const handleChange = useCallback(
    (_: SyntheticEvent, next: CountryOption | null) => {
      onChange(next ? next.iso2.toLowerCase() : null);
    },
    [onChange],
  );

  // Search filter — match against the resolved label, iso2, AND the
  // other-locale name so the user can type "Russ" or "Рос" and find
  // the same row regardless of the active UI language.
  const filterOptions = useCallback(
    (opts: CountryOption[], state: { inputValue: string }) => {
      const q = state.inputValue.trim().toLowerCase();
      if (!q) return opts;
      return opts.filter((o) => {
        if (o.iso2.toLowerCase().includes(q)) return true;
        if (label_(o).toLowerCase().includes(q)) return true;
        // Cross-locale search: always check both en and ru.
        if (o.en.toLowerCase().includes(q)) return true;
        if (o.ru.toLowerCase().includes(q)) return true;
        return false;
      });
    },
    [label_],
  );

  return (
    <Autocomplete<CountryOption, false, false, false>
      value={selected}
      onChange={handleChange}
      options={optionsWithWorld}
      getOptionLabel={label_}
      isOptionEqualToValue={(a, b) => a.iso2.toLowerCase() === b.iso2.toLowerCase()}
      filterOptions={filterOptions}
      disabled={disabled}
      fullWidth={fullWidth}
      size={size}
      autoHighlight
      // Keep popup snappy on long lists — virtualisation would be
      // nicer for >500 rows but 250 ISO countries paint in well
      // under one frame at the default rendering cost.
      renderOption={(props, option) => {
        const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
        const isWorldRow = worldwideValue !== undefined && option.iso2 === worldwideValue;
        const src = isWorldRow ? null : getFlagSrc?.(option.iso2.toLowerCase()) ?? null;
        return (
          <Box
            component="li"
            key={key}
            {...rest}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              px: 1.25,
              py: 0.75,
              // Pin the worldwide row visually with a divider so the
              // user reads it as a separate semantic group.
              ...(isWorldRow && {
                borderBottom: '1px solid',
                borderColor: 'divider',
                mb: 0.5,
              }),
            }}
          >
            <FlagIcon src={src} alt={label_(option)} code={option.iso2} />
            <Typography
              variant="body2"
              sx={{ flex: 1, fontWeight: isWorldRow ? 600 : 400 }}
            >
              {label_(option)}
            </Typography>
            {!isWorldRow && (
              <Typography
                variant="caption"
                sx={{
                  color: 'text.disabled',
                  fontFamily: 'monospace',
                  textTransform: 'uppercase',
                }}
              >
                {option.iso2}
              </Typography>
            )}
          </Box>
        );
      }}
      renderInput={(params) => {
        const src = !isWorld && selected && getFlagSrc
          ? getFlagSrc(selected.iso2.toLowerCase()) ?? null
          : null;
        const startAdornment = selected ? (
          <InputAdornment position="start" sx={{ ml: 0.75, mr: -0.5 }}>
            <FlagIcon
              src={src}
              alt={selected ? label_(selected) : ''}
              code={isWorld ? undefined : selected?.iso2}
            />
          </InputAdornment>
        ) : null;

        return (
          <TextField
            {...params}
            label={label}
            placeholder={placeholder}
            helperText={helperText}
            error={error}
            {...textFieldProps}
            slotProps={{
              ...(textFieldProps?.slotProps ?? {}),
              // MUI v9 renamed Autocomplete renderInput's
              // `InputProps` / `inputProps` to `slotProps.{input,
              // htmlInput}`. Merge our flag adornment on top of the
              // input slot while keeping the chevron+clear adornments
              // that Autocomplete itself injects.
              input: {
                ...params.slotProps.input,
                ...((textFieldProps?.slotProps as { input?: object } | undefined)?.input ?? {}),
                startAdornment: startAdornment ?? params.slotProps.input.startAdornment,
              },
              htmlInput: {
                ...params.slotProps.htmlInput,
                autoComplete: 'off',
              },
            }}
          />
        );
      }}
      {...(autocompleteProps as object)}
    />
  );
}
