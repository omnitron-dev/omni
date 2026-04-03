'use client';

/**
 * Field.Phone Component
 *
 * React Hook Form integrated international phone number input.
 * Provides country selection with flag display and validation.
 *
 * @module @omnitron/prism/components/field
 */

import type { ReactNode, ChangeEvent } from 'react';
import { useState, useCallback, useMemo, useRef } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { TextFieldProps } from '@mui/material/TextField';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Country data structure
 */
export interface CountryData {
  /** ISO 3166-1 alpha-2 code */
  code: string;
  /** Country name */
  name: string;
  /** Dial code with + prefix */
  dialCode: string;
  /** Flag emoji */
  flag: string;
}

/**
 * Props for Field.Phone component.
 */
export interface FieldPhoneProps extends Omit<TextFieldProps, 'name' | 'value' | 'onChange'> {
  /** Field name in the form */
  name: string;
  /** Default country code (e.g., 'US') */
  defaultCountry?: string;
  /** Preferred countries shown at top of list */
  preferredCountries?: string[];
  /** Hide country selector */
  hideCountrySelect?: boolean;
  /** Custom countries data (overrides default) */
  countries?: CountryData[];
}

// =============================================================================
// DEFAULT COUNTRIES DATA
// =============================================================================

const DEFAULT_COUNTRIES: CountryData[] = [
  { code: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧' },
  { code: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺' },
  { code: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪' },
  { code: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷' },
  { code: 'IT', name: 'Italy', dialCode: '+39', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', dialCode: '+34', flag: '🇪🇸' },
  { code: 'JP', name: 'Japan', dialCode: '+81', flag: '🇯🇵' },
  { code: 'CN', name: 'China', dialCode: '+86', flag: '🇨🇳' },
  { code: 'KR', name: 'South Korea', dialCode: '+82', flag: '🇰🇷' },
  { code: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳' },
  { code: 'BR', name: 'Brazil', dialCode: '+55', flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico', dialCode: '+52', flag: '🇲🇽' },
  { code: 'RU', name: 'Russia', dialCode: '+7', flag: '🇷🇺' },
  { code: 'NL', name: 'Netherlands', dialCode: '+31', flag: '🇳🇱' },
  { code: 'BE', name: 'Belgium', dialCode: '+32', flag: '🇧🇪' },
  { code: 'CH', name: 'Switzerland', dialCode: '+41', flag: '🇨🇭' },
  { code: 'AT', name: 'Austria', dialCode: '+43', flag: '🇦🇹' },
  { code: 'SE', name: 'Sweden', dialCode: '+46', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', dialCode: '+47', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', dialCode: '+45', flag: '🇩🇰' },
  { code: 'FI', name: 'Finland', dialCode: '+358', flag: '🇫🇮' },
  { code: 'PL', name: 'Poland', dialCode: '+48', flag: '🇵🇱' },
  { code: 'PT', name: 'Portugal', dialCode: '+351', flag: '🇵🇹' },
  { code: 'GR', name: 'Greece', dialCode: '+30', flag: '🇬🇷' },
  { code: 'IE', name: 'Ireland', dialCode: '+353', flag: '🇮🇪' },
  { code: 'NZ', name: 'New Zealand', dialCode: '+64', flag: '🇳🇿' },
  { code: 'SG', name: 'Singapore', dialCode: '+65', flag: '🇸🇬' },
  { code: 'HK', name: 'Hong Kong', dialCode: '+852', flag: '🇭🇰' },
  { code: 'AE', name: 'UAE', dialCode: '+971', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966', flag: '🇸🇦' },
  { code: 'IL', name: 'Israel', dialCode: '+972', flag: '🇮🇱' },
  { code: 'TR', name: 'Turkey', dialCode: '+90', flag: '🇹🇷' },
  { code: 'ZA', name: 'South Africa', dialCode: '+27', flag: '🇿🇦' },
  { code: 'EG', name: 'Egypt', dialCode: '+20', flag: '🇪🇬' },
  { code: 'NG', name: 'Nigeria', dialCode: '+234', flag: '🇳🇬' },
  { code: 'KE', name: 'Kenya', dialCode: '+254', flag: '🇰🇪' },
  { code: 'AR', name: 'Argentina', dialCode: '+54', flag: '🇦🇷' },
  { code: 'CL', name: 'Chile', dialCode: '+56', flag: '🇨🇱' },
  { code: 'CO', name: 'Colombia', dialCode: '+57', flag: '🇨🇴' },
  { code: 'PE', name: 'Peru', dialCode: '+51', flag: '🇵🇪' },
  { code: 'VE', name: 'Venezuela', dialCode: '+58', flag: '🇻🇪' },
  { code: 'TH', name: 'Thailand', dialCode: '+66', flag: '🇹🇭' },
  { code: 'VN', name: 'Vietnam', dialCode: '+84', flag: '🇻🇳' },
  { code: 'MY', name: 'Malaysia', dialCode: '+60', flag: '🇲🇾' },
  { code: 'ID', name: 'Indonesia', dialCode: '+62', flag: '🇮🇩' },
  { code: 'PH', name: 'Philippines', dialCode: '+63', flag: '🇵🇭' },
  { code: 'PK', name: 'Pakistan', dialCode: '+92', flag: '🇵🇰' },
  { code: 'BD', name: 'Bangladesh', dialCode: '+880', flag: '🇧🇩' },
  { code: 'UA', name: 'Ukraine', dialCode: '+380', flag: '🇺🇦' },
  { code: 'CZ', name: 'Czech Republic', dialCode: '+420', flag: '🇨🇿' },
  { code: 'RO', name: 'Romania', dialCode: '+40', flag: '🇷🇴' },
  { code: 'HU', name: 'Hungary', dialCode: '+36', flag: '🇭🇺' },
];

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Format phone number by removing non-digit characters except +
 */
function formatPhoneNumber(value: string): string {
  return value.replace(/[^\d+]/g, '');
}

/**
 * Detect country from phone number based on dial code
 */
function detectCountryFromNumber(phoneNumber: string, countries: CountryData[]): CountryData | null {
  if (!phoneNumber.startsWith('+')) return null;

  // Sort by dial code length (longer first) for more specific matching
  const sortedCountries = [...countries].sort((a, b) => b.dialCode.length - a.dialCode.length);

  for (const country of sortedCountries) {
    if (phoneNumber.startsWith(country.dialCode)) {
      return country;
    }
  }

  return null;
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Field.Phone - International phone input with React Hook Form integration.
 *
 * Features:
 * - Country selector with flags
 * - Automatic country detection from dial code
 * - Preferred countries list
 * - Phone number formatting
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.Phone
 *     name="phone"
 *     label="Phone Number"
 *     defaultCountry="US"
 *   />
 * </FormProvider>
 * ```
 *
 * @example
 * ```tsx
 * // With preferred countries
 * <Field.Phone
 *   name="mobile"
 *   label="Mobile"
 *   defaultCountry="GB"
 *   preferredCountries={['GB', 'US', 'DE', 'FR']}
 * />
 * ```
 *
 * @example
 * ```tsx
 * // Hide country selector
 * <Field.Phone
 *   name="phone"
 *   label="Phone"
 *   hideCountrySelect
 *   defaultCountry="US"
 * />
 * ```
 */
export function FieldPhone({
  name,
  label,
  helperText,
  defaultCountry = 'US',
  preferredCountries = [],
  hideCountrySelect = false,
  countries: customCountries,
  disabled,
  ...other
}: FieldPhoneProps): ReactNode {
  const { control } = useFormContext();
  const countries = customCountries ?? DEFAULT_COUNTRIES;
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Get default country data
  const defaultCountryData = useMemo(
    () => countries.find((c) => c.code === defaultCountry) ?? countries[0],
    [countries, defaultCountry]
  );

  // Sort countries with preferred at top
  const sortedCountries = useMemo(() => {
    if (preferredCountries.length === 0) return countries;

    const preferred = preferredCountries
      .map((code) => countries.find((c) => c.code === code))
      .filter(Boolean) as CountryData[];

    const rest = countries.filter((c) => !preferredCountries.includes(c.code));

    return [...preferred, ...rest];
  }, [countries, preferredCountries]);

  const handleOpenMenu = useCallback(() => {
    if (!disabled) {
      setMenuOpen(true);
    }
  }, [disabled]);

  const handleCloseMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        // Detect country from current value
        const detectedCountry = field.value ? detectCountryFromNumber(field.value, countries) : null;
        const selectedCountry = detectedCountry ?? defaultCountryData;

        const handleCountrySelect = (country: CountryData) => {
          // Update value with new dial code
          const currentNumber = field.value ?? '';
          const numberWithoutCode = currentNumber.replace(/^\+\d+\s*/, '');
          field.onChange(`${country.dialCode}${numberWithoutCode}`);
          handleCloseMenu();
        };

        const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
          const rawValue = e.target.value;
          const formatted = formatPhoneNumber(rawValue);

          // If user starts typing without +, prepend country code
          if (formatted && !formatted.startsWith('+')) {
            field.onChange(`${selectedCountry.dialCode}${formatted}`);
          } else {
            field.onChange(formatted);
          }
        };

        // Display value: show number without leading dial code for cleaner UI
        const displayValue = field.value ?? '';

        return (
          <>
            <TextField
              {...other}
              label={label}
              value={displayValue}
              onChange={handleInputChange}
              disabled={disabled}
              error={!!error}
              helperText={error?.message ?? helperText}
              fullWidth
              slotProps={{
                input: {
                  startAdornment: !hideCountrySelect && (
                    <InputAdornment position="start">
                      <IconButton
                        ref={anchorRef}
                        onClick={handleOpenMenu}
                        disabled={disabled}
                        size="small"
                        edge="start"
                        aria-label={`Select country, current: ${selectedCountry.name}`}
                        aria-haspopup="listbox"
                        aria-expanded={menuOpen}
                        sx={{ mr: -0.5 }}
                      >
                        <Box
                          component="span"
                          sx={{
                            fontSize: '1.25rem',
                            lineHeight: 1,
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          {selectedCountry.flag}
                        </Box>
                      </IconButton>
                      <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5, minWidth: 40 }}>
                        {selectedCountry.dialCode}
                      </Typography>
                    </InputAdornment>
                  ),
                },
                htmlInput: {
                  inputMode: 'tel',
                  autoComplete: 'tel',
                },
              }}
            />

            <Menu
              anchorEl={anchorRef.current}
              open={menuOpen}
              onClose={handleCloseMenu}
              slotProps={{
                paper: {
                  sx: {
                    maxHeight: 300,
                    minWidth: 280,
                  },
                },
              }}
            >
              {sortedCountries.map((country, index) => (
                <MenuItem
                  key={country.code}
                  selected={country.code === selectedCountry.code}
                  onClick={() => handleCountrySelect(country)}
                  divider={preferredCountries.length > 0 && index === preferredCountries.length - 1}
                >
                  <ListItemIcon sx={{ fontSize: '1.25rem', minWidth: 36 }}>{country.flag}</ListItemIcon>
                  <ListItemText primary={country.name} secondary={country.dialCode} />
                </MenuItem>
              ))}
            </Menu>
          </>
        );
      }}
    />
  );
}
