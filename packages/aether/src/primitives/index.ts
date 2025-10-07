/**
 * UI Primitives
 *
 * Headless, accessible UI components
 *
 * @module primitives
 */

// Dialog
export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogContext,
  type DialogProps,
  type DialogContextValue,
  type DialogTriggerProps,
  type DialogContentProps,
} from './Dialog.js';

// Popover
export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverArrow,
  PopoverClose,
  PopoverContext,
  type PopoverProps,
  type PopoverContextValue,
  type PopoverTriggerProps,
  type PopoverContentProps,
  type PopoverArrowProps,
  type PopoverCloseProps,
} from './Popover.js';

// Dropdown Menu
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItemIndicator,
  DropdownMenuShortcut,
  DropdownMenuContext,
  type DropdownMenuProps,
  type DropdownMenuTriggerProps,
  type DropdownMenuContentProps,
  type DropdownMenuItemProps,
  type DropdownMenuCheckboxItemProps,
  type DropdownMenuRadioGroupProps,
  type DropdownMenuRadioItemProps,
  type DropdownMenuLabelProps,
  type DropdownMenuSeparatorProps,
  type DropdownMenuShortcutProps,
  type DropdownMenuItemIndicatorProps,
  type DropdownMenuContextValue,
} from './DropdownMenu.js';

// Select
export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectIcon,
  SelectContent,
  SelectViewport,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
  SelectContext,
  type SelectProps,
  type SelectTriggerProps,
  type SelectValueProps,
  type SelectIconProps,
  type SelectContentProps,
  type SelectViewportProps,
  type SelectItemProps,
  type SelectItemTextProps,
  type SelectItemIndicatorProps,
  type SelectGroupProps,
  type SelectLabelProps,
  type SelectSeparatorProps,
  type SelectContextValue,
} from './Select.js';

// Tabs
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  TabsContext,
  type TabsProps,
  type TabsListProps,
  type TabsTriggerProps,
  type TabsContentProps,
  type TabsContextValue,
} from './Tabs.js';

// Accordion
export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  AccordionContext,
  AccordionItemContext,
  type AccordionProps,
  type AccordionSingleProps,
  type AccordionMultipleProps,
  type AccordionItemProps,
  type AccordionTriggerProps,
  type AccordionContentProps,
  type AccordionContextValue,
  type AccordionItemContextValue,
} from './Accordion.js';

// Switch
export {
  Switch,
  SwitchThumb,
  SwitchContext,
  type SwitchProps,
  type SwitchThumbProps,
  type SwitchContextValue,
} from './Switch.js';

// Form
export {
  Form,
  FormRoot,
  FormField,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
  type FormRootProps,
  type FormFieldProps,
  type FormLabelProps,
  type FormControlProps,
  type FormMessageProps,
  type FormDescriptionProps,
  type FormFieldContextValue,
} from './Form.js';

// Radio Group
export {
  RadioGroup,
  RadioGroupItem,
  RadioGroupIndicator,
  RadioGroupContext,
  RadioGroupItemContext,
  type RadioGroupProps,
  type RadioGroupItemProps,
  type RadioGroupIndicatorProps,
  type RadioGroupContextValue,
  type RadioGroupItemContextValue,
} from './RadioGroup.js';

// Checkbox
export {
  Checkbox,
  CheckboxIndicator,
  CheckboxContext,
  type CheckboxProps,
  type CheckboxIndicatorProps,
  type CheckboxContextValue,
  type CheckedState,
} from './Checkbox.js';

// Toggle
export {
  Toggle,
  type ToggleProps,
} from './Toggle.js';

// AlertDialog
export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContext,
  type AlertDialogProps,
  type AlertDialogContentProps,
  type AlertDialogContextValue,
} from './AlertDialog.js';

// Slider
export {
  Slider,
  SliderTrack,
  SliderRange,
  SliderThumb,
  SliderContext,
  type SliderProps,
  type SliderThumbProps,
  type SliderContextValue,
} from './Slider.js';

// Tooltip
export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipArrow,
  TooltipContext,
  type TooltipProps,
  type TooltipContentProps,
  type TooltipArrowProps,
  type TooltipContextValue,
} from './Tooltip.js';

// Separator
export {
  Separator,
  type SeparatorProps,
} from './Separator.js';

// ContextMenu
export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuContext,
  type ContextMenuProps,
  type ContextMenuTriggerProps,
  type ContextMenuContentProps,
  type ContextMenuContextValue,
} from './ContextMenu.js';

// Utilities
export {
  // ID generation
  generateId,
  useId,
  createIdGenerator,
  // Focus management
  getFocusableElements,
  getFocusableBounds,
  focusFirst,
  saveFocus,
  restoreFocus,
  trapFocus,
  // Scroll lock
  disableBodyScroll,
  enableBodyScroll,
  isBodyScrollLocked,
  forceUnlockBodyScroll,
  // Positioning
  calculatePosition,
  applyPosition,
  calculateArrowPosition,
  type Side,
  type Align,
  type PositionConfig,
  type Position,
} from './utils/index.js';
