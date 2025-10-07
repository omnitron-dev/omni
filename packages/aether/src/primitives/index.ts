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

// HoverCard
export {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  HoverCardArrow,
  HoverCardContext,
  type HoverCardProps,
  type HoverCardContentProps,
  type HoverCardArrowProps,
  type HoverCardContextValue,
} from './HoverCard.js';

// Sheet
export {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetClose,
  SheetContext,
  type SheetProps,
  type SheetContentProps,
  type SheetSide,
  type SheetContextValue,
} from './Sheet.js';

// Avatar
export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarContext,
  type AvatarProps,
  type AvatarImageProps,
  type AvatarFallbackProps,
  type AvatarContextValue,
} from './Avatar.js';

// Badge
export {
  Badge,
  type BadgeProps,
} from './Badge.js';

// Progress
export {
  Progress,
  ProgressIndicator,
  ProgressContext,
  type ProgressProps,
  type ProgressIndicatorProps,
  type ProgressContextValue,
} from './Progress.js';

// AspectRatio
export {
  AspectRatio,
  type AspectRatioProps,
} from './AspectRatio.js';

// Toast
export {
  Toast,
  ToastProvider,
  ToastViewport,
  ToastContext,
  type ToastProps,
  type ToastData,
  type ToastProviderProps,
  type ToastViewportProps,
  type ToastContextValue,
} from './Toast.js';

// Collapsible
export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  CollapsibleContext,
  type CollapsibleProps,
  type CollapsibleTriggerProps,
  type CollapsibleContentProps,
  type CollapsibleContextValue,
} from './Collapsible.js';

// Skeleton
export {
  Skeleton,
  type SkeletonProps,
} from './Skeleton.js';

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
