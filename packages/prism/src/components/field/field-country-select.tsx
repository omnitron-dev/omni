'use client';

/**
 * Field.CountrySelect Component
 *
 * React Hook Form integrated country selector with flag icons.
 * Provides searchable country selection with ISO code support.
 *
 * @module @omnitron/prism/components/field
 */

import type { ReactNode, SyntheticEvent } from 'react';
import { useMemo } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import type { AutocompleteProps } from '@mui/material/Autocomplete';
import type { TextFieldProps } from '@mui/material/TextField';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Country data structure
 */
export interface Country {
  /** ISO 3166-1 alpha-2 code */
  code: string;
  /** Country name */
  label: string;
  /** Dial code with + prefix */
  phone: string;
  /** Flag emoji */
  flag: string;
}

/**
 * Props for Field.CountrySelect component.
 */
export interface FieldCountrySelectProps extends Omit<
  AutocompleteProps<Country, boolean, boolean, false>,
  'options' | 'renderInput' | 'value' | 'onChange' | 'getOptionLabel' | 'isOptionEqualToValue'
> {
  /** Field name in the form */
  name: string;
  /** Field label */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Helper text shown below the field */
  helperText?: ReactNode;
  /** Return value type: 'code' returns ISO code, 'label' returns country name */
  getValue?: 'code' | 'label' | 'full';
  /** Custom countries data (overrides default) */
  countries?: Country[];
  /** TextField props for customization */
  textFieldProps?: Partial<TextFieldProps>;
}

// =============================================================================
// DEFAULT COUNTRIES DATA
// =============================================================================

const DEFAULT_COUNTRIES: Country[] = [
  { code: 'AD', label: 'Andorra', phone: '+376', flag: '🇦🇩' },
  { code: 'AE', label: 'United Arab Emirates', phone: '+971', flag: '🇦🇪' },
  { code: 'AF', label: 'Afghanistan', phone: '+93', flag: '🇦🇫' },
  { code: 'AG', label: 'Antigua and Barbuda', phone: '+1-268', flag: '🇦🇬' },
  { code: 'AI', label: 'Anguilla', phone: '+1-264', flag: '🇦🇮' },
  { code: 'AL', label: 'Albania', phone: '+355', flag: '🇦🇱' },
  { code: 'AM', label: 'Armenia', phone: '+374', flag: '🇦🇲' },
  { code: 'AO', label: 'Angola', phone: '+244', flag: '🇦🇴' },
  { code: 'AR', label: 'Argentina', phone: '+54', flag: '🇦🇷' },
  { code: 'AT', label: 'Austria', phone: '+43', flag: '🇦🇹' },
  { code: 'AU', label: 'Australia', phone: '+61', flag: '🇦🇺' },
  { code: 'AZ', label: 'Azerbaijan', phone: '+994', flag: '🇦🇿' },
  { code: 'BA', label: 'Bosnia and Herzegovina', phone: '+387', flag: '🇧🇦' },
  { code: 'BB', label: 'Barbados', phone: '+1-246', flag: '🇧🇧' },
  { code: 'BD', label: 'Bangladesh', phone: '+880', flag: '🇧🇩' },
  { code: 'BE', label: 'Belgium', phone: '+32', flag: '🇧🇪' },
  { code: 'BF', label: 'Burkina Faso', phone: '+226', flag: '🇧🇫' },
  { code: 'BG', label: 'Bulgaria', phone: '+359', flag: '🇧🇬' },
  { code: 'BH', label: 'Bahrain', phone: '+973', flag: '🇧🇭' },
  { code: 'BI', label: 'Burundi', phone: '+257', flag: '🇧🇮' },
  { code: 'BJ', label: 'Benin', phone: '+229', flag: '🇧🇯' },
  { code: 'BN', label: 'Brunei', phone: '+673', flag: '🇧🇳' },
  { code: 'BO', label: 'Bolivia', phone: '+591', flag: '🇧🇴' },
  { code: 'BR', label: 'Brazil', phone: '+55', flag: '🇧🇷' },
  { code: 'BS', label: 'Bahamas', phone: '+1-242', flag: '🇧🇸' },
  { code: 'BT', label: 'Bhutan', phone: '+975', flag: '🇧🇹' },
  { code: 'BW', label: 'Botswana', phone: '+267', flag: '🇧🇼' },
  { code: 'BY', label: 'Belarus', phone: '+375', flag: '🇧🇾' },
  { code: 'BZ', label: 'Belize', phone: '+501', flag: '🇧🇿' },
  { code: 'CA', label: 'Canada', phone: '+1', flag: '🇨🇦' },
  { code: 'CH', label: 'Switzerland', phone: '+41', flag: '🇨🇭' },
  { code: 'CL', label: 'Chile', phone: '+56', flag: '🇨🇱' },
  { code: 'CN', label: 'China', phone: '+86', flag: '🇨🇳' },
  { code: 'CO', label: 'Colombia', phone: '+57', flag: '🇨🇴' },
  { code: 'CR', label: 'Costa Rica', phone: '+506', flag: '🇨🇷' },
  { code: 'CU', label: 'Cuba', phone: '+53', flag: '🇨🇺' },
  { code: 'CY', label: 'Cyprus', phone: '+357', flag: '🇨🇾' },
  { code: 'CZ', label: 'Czech Republic', phone: '+420', flag: '🇨🇿' },
  { code: 'DE', label: 'Germany', phone: '+49', flag: '🇩🇪' },
  { code: 'DJ', label: 'Djibouti', phone: '+253', flag: '🇩🇯' },
  { code: 'DK', label: 'Denmark', phone: '+45', flag: '🇩🇰' },
  { code: 'DM', label: 'Dominica', phone: '+1-767', flag: '🇩🇲' },
  { code: 'DO', label: 'Dominican Republic', phone: '+1-809', flag: '🇩🇴' },
  { code: 'DZ', label: 'Algeria', phone: '+213', flag: '🇩🇿' },
  { code: 'EC', label: 'Ecuador', phone: '+593', flag: '🇪🇨' },
  { code: 'EE', label: 'Estonia', phone: '+372', flag: '🇪🇪' },
  { code: 'EG', label: 'Egypt', phone: '+20', flag: '🇪🇬' },
  { code: 'ES', label: 'Spain', phone: '+34', flag: '🇪🇸' },
  { code: 'ET', label: 'Ethiopia', phone: '+251', flag: '🇪🇹' },
  { code: 'FI', label: 'Finland', phone: '+358', flag: '🇫🇮' },
  { code: 'FJ', label: 'Fiji', phone: '+679', flag: '🇫🇯' },
  { code: 'FR', label: 'France', phone: '+33', flag: '🇫🇷' },
  { code: 'GA', label: 'Gabon', phone: '+241', flag: '🇬🇦' },
  { code: 'GB', label: 'United Kingdom', phone: '+44', flag: '🇬🇧' },
  { code: 'GE', label: 'Georgia', phone: '+995', flag: '🇬🇪' },
  { code: 'GH', label: 'Ghana', phone: '+233', flag: '🇬🇭' },
  { code: 'GR', label: 'Greece', phone: '+30', flag: '🇬🇷' },
  { code: 'GT', label: 'Guatemala', phone: '+502', flag: '🇬🇹' },
  { code: 'GY', label: 'Guyana', phone: '+592', flag: '🇬🇾' },
  { code: 'HK', label: 'Hong Kong', phone: '+852', flag: '🇭🇰' },
  { code: 'HN', label: 'Honduras', phone: '+504', flag: '🇭🇳' },
  { code: 'HR', label: 'Croatia', phone: '+385', flag: '🇭🇷' },
  { code: 'HT', label: 'Haiti', phone: '+509', flag: '🇭🇹' },
  { code: 'HU', label: 'Hungary', phone: '+36', flag: '🇭🇺' },
  { code: 'ID', label: 'Indonesia', phone: '+62', flag: '🇮🇩' },
  { code: 'IE', label: 'Ireland', phone: '+353', flag: '🇮🇪' },
  { code: 'IL', label: 'Israel', phone: '+972', flag: '🇮🇱' },
  { code: 'IN', label: 'India', phone: '+91', flag: '🇮🇳' },
  { code: 'IQ', label: 'Iraq', phone: '+964', flag: '🇮🇶' },
  { code: 'IR', label: 'Iran', phone: '+98', flag: '🇮🇷' },
  { code: 'IS', label: 'Iceland', phone: '+354', flag: '🇮🇸' },
  { code: 'IT', label: 'Italy', phone: '+39', flag: '🇮🇹' },
  { code: 'JM', label: 'Jamaica', phone: '+1-876', flag: '🇯🇲' },
  { code: 'JO', label: 'Jordan', phone: '+962', flag: '🇯🇴' },
  { code: 'JP', label: 'Japan', phone: '+81', flag: '🇯🇵' },
  { code: 'KE', label: 'Kenya', phone: '+254', flag: '🇰🇪' },
  { code: 'KG', label: 'Kyrgyzstan', phone: '+996', flag: '🇰🇬' },
  { code: 'KH', label: 'Cambodia', phone: '+855', flag: '🇰🇭' },
  { code: 'KR', label: 'South Korea', phone: '+82', flag: '🇰🇷' },
  { code: 'KW', label: 'Kuwait', phone: '+965', flag: '🇰🇼' },
  { code: 'KZ', label: 'Kazakhstan', phone: '+7', flag: '🇰🇿' },
  { code: 'LA', label: 'Laos', phone: '+856', flag: '🇱🇦' },
  { code: 'LB', label: 'Lebanon', phone: '+961', flag: '🇱🇧' },
  { code: 'LK', label: 'Sri Lanka', phone: '+94', flag: '🇱🇰' },
  { code: 'LR', label: 'Liberia', phone: '+231', flag: '🇱🇷' },
  { code: 'LT', label: 'Lithuania', phone: '+370', flag: '🇱🇹' },
  { code: 'LU', label: 'Luxembourg', phone: '+352', flag: '🇱🇺' },
  { code: 'LV', label: 'Latvia', phone: '+371', flag: '🇱🇻' },
  { code: 'LY', label: 'Libya', phone: '+218', flag: '🇱🇾' },
  { code: 'MA', label: 'Morocco', phone: '+212', flag: '🇲🇦' },
  { code: 'MC', label: 'Monaco', phone: '+377', flag: '🇲🇨' },
  { code: 'MD', label: 'Moldova', phone: '+373', flag: '🇲🇩' },
  { code: 'ME', label: 'Montenegro', phone: '+382', flag: '🇲🇪' },
  { code: 'MG', label: 'Madagascar', phone: '+261', flag: '🇲🇬' },
  { code: 'MK', label: 'North Macedonia', phone: '+389', flag: '🇲🇰' },
  { code: 'ML', label: 'Mali', phone: '+223', flag: '🇲🇱' },
  { code: 'MM', label: 'Myanmar', phone: '+95', flag: '🇲🇲' },
  { code: 'MN', label: 'Mongolia', phone: '+976', flag: '🇲🇳' },
  { code: 'MO', label: 'Macau', phone: '+853', flag: '🇲🇴' },
  { code: 'MT', label: 'Malta', phone: '+356', flag: '🇲🇹' },
  { code: 'MU', label: 'Mauritius', phone: '+230', flag: '🇲🇺' },
  { code: 'MV', label: 'Maldives', phone: '+960', flag: '🇲🇻' },
  { code: 'MW', label: 'Malawi', phone: '+265', flag: '🇲🇼' },
  { code: 'MX', label: 'Mexico', phone: '+52', flag: '🇲🇽' },
  { code: 'MY', label: 'Malaysia', phone: '+60', flag: '🇲🇾' },
  { code: 'MZ', label: 'Mozambique', phone: '+258', flag: '🇲🇿' },
  { code: 'NA', label: 'Namibia', phone: '+264', flag: '🇳🇦' },
  { code: 'NE', label: 'Niger', phone: '+227', flag: '🇳🇪' },
  { code: 'NG', label: 'Nigeria', phone: '+234', flag: '🇳🇬' },
  { code: 'NI', label: 'Nicaragua', phone: '+505', flag: '🇳🇮' },
  { code: 'NL', label: 'Netherlands', phone: '+31', flag: '🇳🇱' },
  { code: 'NO', label: 'Norway', phone: '+47', flag: '🇳🇴' },
  { code: 'NP', label: 'Nepal', phone: '+977', flag: '🇳🇵' },
  { code: 'NZ', label: 'New Zealand', phone: '+64', flag: '🇳🇿' },
  { code: 'OM', label: 'Oman', phone: '+968', flag: '🇴🇲' },
  { code: 'PA', label: 'Panama', phone: '+507', flag: '🇵🇦' },
  { code: 'PE', label: 'Peru', phone: '+51', flag: '🇵🇪' },
  { code: 'PG', label: 'Papua New Guinea', phone: '+675', flag: '🇵🇬' },
  { code: 'PH', label: 'Philippines', phone: '+63', flag: '🇵🇭' },
  { code: 'PK', label: 'Pakistan', phone: '+92', flag: '🇵🇰' },
  { code: 'PL', label: 'Poland', phone: '+48', flag: '🇵🇱' },
  { code: 'PT', label: 'Portugal', phone: '+351', flag: '🇵🇹' },
  { code: 'PY', label: 'Paraguay', phone: '+595', flag: '🇵🇾' },
  { code: 'QA', label: 'Qatar', phone: '+974', flag: '🇶🇦' },
  { code: 'RO', label: 'Romania', phone: '+40', flag: '🇷🇴' },
  { code: 'RS', label: 'Serbia', phone: '+381', flag: '🇷🇸' },
  { code: 'RU', label: 'Russia', phone: '+7', flag: '🇷🇺' },
  { code: 'RW', label: 'Rwanda', phone: '+250', flag: '🇷🇼' },
  { code: 'SA', label: 'Saudi Arabia', phone: '+966', flag: '🇸🇦' },
  { code: 'SD', label: 'Sudan', phone: '+249', flag: '🇸🇩' },
  { code: 'SE', label: 'Sweden', phone: '+46', flag: '🇸🇪' },
  { code: 'SG', label: 'Singapore', phone: '+65', flag: '🇸🇬' },
  { code: 'SI', label: 'Slovenia', phone: '+386', flag: '🇸🇮' },
  { code: 'SK', label: 'Slovakia', phone: '+421', flag: '🇸🇰' },
  { code: 'SL', label: 'Sierra Leone', phone: '+232', flag: '🇸🇱' },
  { code: 'SN', label: 'Senegal', phone: '+221', flag: '🇸🇳' },
  { code: 'SO', label: 'Somalia', phone: '+252', flag: '🇸🇴' },
  { code: 'SR', label: 'Suriname', phone: '+597', flag: '🇸🇷' },
  { code: 'SV', label: 'El Salvador', phone: '+503', flag: '🇸🇻' },
  { code: 'SY', label: 'Syria', phone: '+963', flag: '🇸🇾' },
  { code: 'TH', label: 'Thailand', phone: '+66', flag: '🇹🇭' },
  { code: 'TJ', label: 'Tajikistan', phone: '+992', flag: '🇹🇯' },
  { code: 'TM', label: 'Turkmenistan', phone: '+993', flag: '🇹🇲' },
  { code: 'TN', label: 'Tunisia', phone: '+216', flag: '🇹🇳' },
  { code: 'TR', label: 'Turkey', phone: '+90', flag: '🇹🇷' },
  { code: 'TT', label: 'Trinidad and Tobago', phone: '+1-868', flag: '🇹🇹' },
  { code: 'TW', label: 'Taiwan', phone: '+886', flag: '🇹🇼' },
  { code: 'TZ', label: 'Tanzania', phone: '+255', flag: '🇹🇿' },
  { code: 'UA', label: 'Ukraine', phone: '+380', flag: '🇺🇦' },
  { code: 'UG', label: 'Uganda', phone: '+256', flag: '🇺🇬' },
  { code: 'US', label: 'United States', phone: '+1', flag: '🇺🇸' },
  { code: 'UY', label: 'Uruguay', phone: '+598', flag: '🇺🇾' },
  { code: 'UZ', label: 'Uzbekistan', phone: '+998', flag: '🇺🇿' },
  { code: 'VE', label: 'Venezuela', phone: '+58', flag: '🇻🇪' },
  { code: 'VN', label: 'Vietnam', phone: '+84', flag: '🇻🇳' },
  { code: 'YE', label: 'Yemen', phone: '+967', flag: '🇾🇪' },
  { code: 'ZA', label: 'South Africa', phone: '+27', flag: '🇿🇦' },
  { code: 'ZM', label: 'Zambia', phone: '+260', flag: '🇿🇲' },
  { code: 'ZW', label: 'Zimbabwe', phone: '+263', flag: '🇿🇼' },
];

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Field.CountrySelect - Country selector with React Hook Form integration.
 *
 * Features:
 * - Searchable country list with flag icons
 * - Return ISO code, country name, or full object
 * - Custom country data support
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.CountrySelect
 *     name="country"
 *     label="Country"
 *   />
 * </FormProvider>
 * ```
 *
 * @example
 * ```tsx
 * // Return ISO code instead of full object
 * <Field.CountrySelect
 *   name="countryCode"
 *   label="Country"
 *   getValue="code"
 * />
 * ```
 *
 * @example
 * ```tsx
 * // Multiple selection
 * <Field.CountrySelect
 *   name="visitedCountries"
 *   label="Countries Visited"
 *   multiple
 *   getValue="code"
 * />
 * ```
 */
export function FieldCountrySelect({
  name,
  label,
  placeholder,
  helperText,
  getValue = 'full',
  countries: customCountries,
  textFieldProps,
  multiple,
  disabled,
  ...other
}: FieldCountrySelectProps): ReactNode {
  const { control } = useFormContext();
  const countries = customCountries ?? DEFAULT_COUNTRIES;

  // Create a lookup map for finding country by code or label
  const countryMap = useMemo(() => {
    const byCode = new Map<string, Country>();
    const byLabel = new Map<string, Country>();
    for (const country of countries) {
      byCode.set(country.code, country);
      byLabel.set(country.label, country);
    }
    return { byCode, byLabel };
  }, [countries]);

  // Find country by code or label
  const findCountry = (v: unknown): Country | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'object' && v !== null && 'code' in v) {
      return v as Country;
    }
    if (typeof v === 'string') {
      return countryMap.byCode.get(v) ?? countryMap.byLabel.get(v) ?? null;
    }
    return null;
  };

  // Convert stored value back to Country object(s)
  const valueToCountry = (value: unknown): Country | Country[] | null => {
    if (value === null || value === undefined) {
      return multiple ? [] : null;
    }

    if (multiple) {
      const values = Array.isArray(value) ? value : [value];
      return values.map(findCountry).filter((c): c is Country => c !== null);
    }

    return findCountry(value);
  };

  // Convert Country object(s) to storage format
  const countryToValue = (country: Country | Country[] | null): unknown => {
    if (country === null) {
      return multiple ? [] : null;
    }

    if (multiple && Array.isArray(country)) {
      if (getValue === 'code') return country.map((c) => c.code);
      if (getValue === 'label') return country.map((c) => c.label);
      return country;
    }

    if (!Array.isArray(country)) {
      if (getValue === 'code') return country.code;
      if (getValue === 'label') return country.label;
      return country;
    }

    return null;
  };

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        const currentValue = valueToCountry(field.value);

        return (
          <Autocomplete
            {...other}
            multiple={multiple}
            disabled={disabled}
            options={countries}
            value={currentValue}
            onChange={(_event: SyntheticEvent, newValue: Country | Country[] | null) => {
              field.onChange(countryToValue(newValue));
            }}
            getOptionLabel={(option: Country) => option.label}
            isOptionEqualToValue={(option: Country, value: Country) => option.code === value.code}
            renderOption={(props, option: Country) => {
              const { key, ...optionProps } = props;
              return (
                <Box key={key} component="li" sx={{ '& > span': { mr: 1.5, flexShrink: 0 } }} {...optionProps}>
                  <span style={{ fontSize: '1.25rem' }}>{option.flag}</span>
                  {option.label} ({option.code})
                </Box>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                {...textFieldProps}
                label={label}
                placeholder={placeholder}
                error={!!error}
                helperText={error?.message ?? helperText}
                slotProps={{
                  ...textFieldProps?.slotProps,
                  htmlInput: {
                    ...params.inputProps,
                    autoComplete: 'country-name',
                  },
                }}
              />
            )}
          />
        );
      }}
    />
  );
}
