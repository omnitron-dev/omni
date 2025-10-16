/**
 * Styled Form Components
 *
 * A complete collection of styled form components built on top of Aether primitives.
 * These components combine the headless functionality of primitives with a beautiful
 * default styling system that can be customized via variants.
 */

// Basic Form Controls
export { Button } from './Button.js';
export { Input } from './Input.js';
export { Textarea } from './Textarea.js';
export { Select } from './Select.js';
export { Label } from './Label.js';

// Selection Controls
export { Checkbox } from './Checkbox.js';
export { RadioGroup } from './RadioGroup.js';
export { Switch } from './Switch.js';
export { MultiSelect } from './MultiSelect.js';
export { Combobox } from './Combobox.js';

// Numeric Inputs
export { Slider } from './Slider.js';
export { RangeSlider } from './RangeSlider.js';
export { NumberInput } from './NumberInput.js';

// Date & Time Pickers
export { DatePicker } from './DatePicker.js';
export { DateRangePicker } from './DateRangePicker.js';
export { TimePicker } from './TimePicker.js';

// Advanced Inputs
export { ColorPicker } from './ColorPicker.js';
export { FileUpload } from './FileUpload.js';
export { PinInput } from './PinInput.js';
export { TagsInput } from './TagsInput.js';
export { Mentions } from './Mentions.js';
export { Editable } from './Editable.js';

// Property Grid
export { PropertyGrid } from './PropertyGrid.js';
export type {
  PropertyDescriptor,
  PropertyGridProps,
  StringPropertyDescriptor,
  NumberPropertyDescriptor,
  BooleanPropertyDescriptor,
  SelectPropertyDescriptor,
  ColorPropertyDescriptor,
  DatePropertyDescriptor,
  ArrayPropertyDescriptor,
  ObjectPropertyDescriptor,
  GroupPropertyDescriptor,
  CustomPropertyDescriptor,
} from './PropertyGrid.js';

// Form Wrapper
export { Form } from './Form.js';
