/**
 * Field Namespace
 *
 * React Hook Form integrated form fields organized under a single namespace.
 * Provides a clean, consistent API for form building.
 *
 * @example
 * ```tsx
 * import { Field } from '@omnitron-dev/prism';
 *
 * function ProfileForm() {
 *   const methods = useForm<ProfileData>();
 *
 *   return (
 *     <FormProvider {...methods}>
 *       <form onSubmit={methods.handleSubmit(onSubmit)}>
 *         <Field.Text name="name" label="Full Name" />
 *         <Field.Text name="email" label="Email" type="email" />
 *         <Field.Select name="country" label="Country" options={countries} />
 *         <Field.Number name="age" label="Age" min={0} max={150} />
 *         <Field.Checkbox name="terms" label="I agree to terms" />
 *         <Field.Switch name="newsletter" label="Subscribe" />
 *         <Field.Phone name="phone" label="Phone" defaultCountry="US" />
 *         <Field.Upload name="avatar" />
 *       </form>
 *     </FormProvider>
 *   );
 * }
 * ```
 *
 * @module @omnitron-dev/prism/components/field
 */

// Base fields
import { FieldText } from './field-text.js';
import { FieldSelect } from './field-select.js';
import { FieldCheckbox } from './field-checkbox.js';
import { FieldSwitch } from './field-switch.js';
import { FieldNumber } from './field-number.js';
import { FieldRadio } from './field-radio.js';
import { FieldAutocomplete } from './field-autocomplete.js';
import { FieldMultiSelect } from './field-multi-select.js';
import { FieldRating } from './field-rating.js';
import { FieldSlider } from './field-slider.js';
import { FieldDatePicker } from './field-date-picker.js';

// New fields (v0.4.0)
import { FieldTimePicker } from './field-time-picker.js';
import { FieldDateTimePicker } from './field-datetime-picker.js';
import { FieldMultiCheckbox } from './field-multi-checkbox.js';
import { FieldMultiSwitch } from './field-multi-switch.js';
import { FieldCode } from './field-code.js';
import { FieldUpload, FieldUploadBox, FieldUploadAvatar } from './field-upload.js';
import { FieldPhone } from './field-phone.js';
import { FieldCountrySelect } from './field-country-select.js';

// Editor fields (v0.4.0)
import { FieldEditor, FieldCustomEditor } from './field-editor.js';

// =============================================================================
// TYPE EXPORTS
// =============================================================================

// Base field types
export type { FieldTextProps } from './field-text.js';
export type { FieldSelectProps } from './field-select.js';
export type { FieldCheckboxProps } from './field-checkbox.js';
export type { FieldSwitchProps } from './field-switch.js';
export type { FieldNumberProps } from './field-number.js';
export type { FieldRadioProps, RadioOption } from './field-radio.js';
export type { FieldAutocompleteProps, AutocompleteOption } from './field-autocomplete.js';
export type { FieldMultiSelectProps, MultiSelectOption } from './field-multi-select.js';
export type { FieldRatingProps } from './field-rating.js';
export type { FieldSliderProps } from './field-slider.js';
export type { FieldDatePickerProps } from './field-date-picker.js';

// New field types (v0.4.0)
export type { FieldTimePickerProps } from './field-time-picker.js';
export type { FieldDateTimePickerProps } from './field-datetime-picker.js';
export type { FieldMultiCheckboxProps, MultiCheckboxOption } from './field-multi-checkbox.js';
export type { FieldMultiSwitchProps, MultiSwitchOption } from './field-multi-switch.js';
export type { FieldCodeProps } from './field-code.js';
export type {
  FieldUploadProps,
  FieldUploadBoxProps,
  FieldUploadAvatarProps,
  FileValue,
  UploadValue,
} from './field-upload.js';
export type { FieldPhoneProps, CountryData } from './field-phone.js';
export type { FieldCountrySelectProps, Country } from './field-country-select.js';

// Editor field types (v0.4.0)
export type {
  FieldEditorProps,
  FieldCustomEditorProps,
  EditorRenderProps,
  EditorToolbarConfig,
} from './field-editor.js';

// =============================================================================
// FIELD NAMESPACE
// =============================================================================

/**
 * Field namespace - React Hook Form integrated form fields.
 *
 * Available fields:
 * - Field.Text - Text input (text, email, password, etc.)
 * - Field.Select - Dropdown select
 * - Field.Checkbox - Checkbox input
 * - Field.Switch - Toggle switch
 * - Field.Number - Numeric input with validation
 * - Field.Radio - Radio button group
 * - Field.Autocomplete - Autocomplete with search
 * - Field.MultiSelect - Multiple selection with chips
 * - Field.Rating - Star rating
 * - Field.Slider - Range slider
 * - Field.DatePicker - Date picker (MUI X)
 * - Field.TimePicker - Time picker (MUI X)
 * - Field.DateTimePicker - Combined date-time picker (MUI X)
 * - Field.MultiCheckbox - Multiple checkbox group
 * - Field.MultiSwitch - Multiple switch group
 * - Field.Code - OTP/PIN code input
 * - Field.Upload - File upload with dropzone
 * - Field.UploadBox - Compact file upload box
 * - Field.UploadAvatar - Circular avatar upload
 * - Field.Phone - International phone input
 * - Field.Editor - Rich text editor (textarea fallback or custom)
 * - Field.CustomEditor - Headless editor with render prop
 */
export const Field = {
  // Base fields
  /** Text input field */
  Text: FieldText,
  /** Select dropdown field */
  Select: FieldSelect,
  /** Checkbox field */
  Checkbox: FieldCheckbox,
  /** Switch toggle field */
  Switch: FieldSwitch,
  /** Number input field */
  Number: FieldNumber,
  /** Radio button group field */
  Radio: FieldRadio,
  /** Autocomplete with search field */
  Autocomplete: FieldAutocomplete,
  /** Multiple selection with chips field */
  MultiSelect: FieldMultiSelect,
  /** Star rating field */
  Rating: FieldRating,
  /** Range slider field */
  Slider: FieldSlider,
  /** Date picker field (MUI X) */
  DatePicker: FieldDatePicker,

  // New fields (v0.4.0)
  /** Time picker field (MUI X) */
  TimePicker: FieldTimePicker,
  /** Combined date-time picker field (MUI X) */
  DateTimePicker: FieldDateTimePicker,
  /** Multiple checkbox group field */
  MultiCheckbox: FieldMultiCheckbox,
  /** Multiple switch group field */
  MultiSwitch: FieldMultiSwitch,
  /** OTP/PIN code input field */
  Code: FieldCode,
  /** File upload with dropzone */
  Upload: FieldUpload,
  /** Compact file upload box */
  UploadBox: FieldUploadBox,
  /** Circular avatar upload */
  UploadAvatar: FieldUploadAvatar,
  /** International phone input */
  Phone: FieldPhone,
  /** Country selector with flags */
  CountrySelect: FieldCountrySelect,

  // Editor fields (v0.4.0)
  /** Rich text editor (with textarea fallback or custom editor) */
  Editor: FieldEditor,
  /** Headless editor field with render prop */
  CustomEditor: FieldCustomEditor,
} as const;

// =============================================================================
// INDIVIDUAL EXPORTS
// =============================================================================

// Also export individual components for those who prefer direct imports
export {
  // Base fields
  FieldText,
  FieldSelect,
  FieldCheckbox,
  FieldSwitch,
  FieldNumber,
  FieldRadio,
  FieldAutocomplete,
  FieldMultiSelect,
  FieldRating,
  FieldSlider,
  FieldDatePicker,
  // New fields (v0.4.0)
  FieldTimePicker,
  FieldDateTimePicker,
  FieldMultiCheckbox,
  FieldMultiSwitch,
  FieldCode,
  FieldUpload,
  FieldUploadBox,
  FieldUploadAvatar,
  FieldPhone,
  FieldCountrySelect,
  // Editor fields (v0.4.0)
  FieldEditor,
  FieldCustomEditor,
};
