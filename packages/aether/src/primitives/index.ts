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

// Label
export {
  Label,
  type LabelProps,
} from './Label.js';

// Input
export {
  Input,
  type InputProps,
} from './Input.js';

// Textarea
export {
  Textarea,
  type TextareaProps,
} from './Textarea.js';

// ScrollArea
export {
  ScrollArea,
  ScrollAreaViewport,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  type ScrollAreaProps,
  type ScrollAreaViewportProps,
  type ScrollAreaScrollbarProps,
  type ScrollAreaThumbProps,
  type ScrollAreaContextValue,
} from './ScrollArea.js';

// Pagination
export {
  Pagination,
  PaginationItems,
  PaginationPrevious,
  PaginationNext,
  type PaginationProps,
  type PaginationItemsProps,
  type PaginationPreviousProps,
  type PaginationNextProps,
  type PaginationContextValue,
} from './Pagination.js';

// Menubar
export {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarLabel,
  MenubarShortcut,
  type MenubarProps,
  type MenubarMenuProps,
  type MenubarTriggerProps,
  type MenubarContentProps,
  type MenubarItemProps,
  type MenubarSeparatorProps,
  type MenubarLabelProps,
  type MenubarShortcutProps,
  type MenubarContextValue,
  type MenubarMenuContextValue,
} from './Menubar.js';

// VisuallyHidden
export {
  VisuallyHidden,
  type VisuallyHiddenProps,
} from './VisuallyHidden.js';

// Card
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  type CardProps,
  type CardHeaderProps,
  type CardTitleProps,
  type CardDescriptionProps,
  type CardContentProps,
  type CardFooterProps,
} from './Card.js';

// Breadcrumb
export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  type BreadcrumbProps,
  type BreadcrumbListProps,
  type BreadcrumbItemProps,
  type BreadcrumbLinkProps,
  type BreadcrumbPageProps,
  type BreadcrumbSeparatorProps,
} from './Breadcrumb.js';

// Toolbar
export {
  Toolbar,
  ToolbarGroup,
  ToolbarButton,
  ToolbarLink,
  ToolbarSeparator,
  ToolbarToggleGroup,
  ToolbarToggleItem,
  type ToolbarProps,
  type ToolbarGroupProps,
  type ToolbarButtonProps,
  type ToolbarLinkProps,
  type ToolbarSeparatorProps,
  type ToolbarToggleGroupProps,
  type ToolbarToggleItemProps,
} from './Toolbar.js';

// Alert
export {
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  type AlertProps,
  type AlertIconProps,
  type AlertTitleProps,
  type AlertDescriptionProps,
} from './Alert.js';

// Kbd
export {
  Kbd,
  type KbdProps,
} from './Kbd.js';

// Code
export {
  Code,
  type CodeProps,
} from './Code.js';

// Table
export {
  Table,
  TableCaption,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  type TableProps,
  type TableCaptionProps,
  type TableHeaderProps,
  type TableBodyProps,
  type TableFooterProps,
  type TableRowProps,
  type TableHeadProps,
  type TableCellProps,
} from './Table.js';

// Combobox
export {
  Combobox,
  ComboboxTrigger,
  ComboboxInput,
  ComboboxIcon,
  ComboboxContent,
  ComboboxViewport,
  ComboboxItem,
  ComboboxEmpty,
  type ComboboxProps,
  type ComboboxTriggerProps,
  type ComboboxInputProps,
  type ComboboxIconProps,
  type ComboboxContentProps,
  type ComboboxViewportProps,
  type ComboboxItemProps,
  type ComboboxEmptyProps,
} from './Combobox.js';

// CommandPalette
export {
  CommandPalette,
  CommandPaletteDialog,
  CommandPaletteInput,
  CommandPaletteList,
  CommandPaletteGroup,
  CommandPaletteItem,
  CommandPaletteSeparator,
  CommandPaletteShortcut,
  CommandPaletteEmpty,
  type CommandPaletteProps,
  type CommandPaletteDialogProps,
  type CommandPaletteInputProps,
  type CommandPaletteListProps,
  type CommandPaletteGroupProps,
  type CommandPaletteItemProps,
  type CommandPaletteSeparatorProps,
  type CommandPaletteShortcutProps,
  type CommandPaletteEmptyProps,
} from './CommandPalette.js';

// Calendar
export {
  Calendar,
  CalendarHeader,
  CalendarPrevButton,
  CalendarNextButton,
  CalendarHeading,
  CalendarGrid,
  CalendarGridHead,
  CalendarHeadCell,
  CalendarGridBody,
  CalendarCell,
  type CalendarProps,
  type CalendarHeaderProps,
  type CalendarPrevButtonProps,
  type CalendarNextButtonProps,
  type CalendarHeadingProps,
  type CalendarGridProps,
  type CalendarGridHeadProps,
  type CalendarHeadCellProps,
  type CalendarGridBodyProps,
  type CalendarCellProps,
} from './Calendar.js';

// DatePicker
export {
  DatePicker,
  DatePickerTrigger,
  DatePickerValue,
  DatePickerIcon,
  DatePickerContent,
  DatePickerCalendar,
  type DatePickerProps,
  type DatePickerTriggerProps,
  type DatePickerValueProps,
  type DatePickerIconProps,
  type DatePickerContentProps,
  type DatePickerCalendarProps,
} from './DatePicker.js';

// NavigationMenu
export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
  type NavigationMenuProps,
  type NavigationMenuListProps,
  type NavigationMenuItemProps,
  type NavigationMenuTriggerProps,
  type NavigationMenuContentProps,
  type NavigationMenuLinkProps,
  type NavigationMenuIndicatorProps,
  type NavigationMenuViewportProps,
} from './NavigationMenu.js';

// Carousel
export {
  Carousel,
  CarouselViewport,
  CarouselSlide,
  CarouselPrevious,
  CarouselNext,
  CarouselIndicators,
  type CarouselProps,
  type CarouselViewportProps,
  type CarouselSlideProps,
  type CarouselPreviousProps,
  type CarouselNextProps,
  type CarouselIndicatorsProps,
} from './Carousel.js';

// Rating
export {
  Rating,
  RatingItem,
  type RatingProps,
  type RatingItemProps,
} from './Rating.js';

// Tree
export {
  Tree,
  TreeItem,
  TreeTrigger,
  TreeContent,
  TreeLabel,
  type TreeProps,
  type TreeItemProps,
  type TreeTriggerProps,
  type TreeContentProps,
  type TreeLabelProps,
} from './Tree.js';

// Stepper
export {
  Stepper,
  StepperList,
  StepperItem,
  StepperTrigger,
  StepperDescription,
  StepperContent,
  StepperSeparator,
  type StepperProps,
  type StepperListProps,
  type StepperItemProps,
  type StepperTriggerProps,
  type StepperDescriptionProps,
  type StepperContentProps,
  type StepperSeparatorProps,
} from './Stepper.js';

// ToggleGroup
export {
  ToggleGroup,
  ToggleGroupItem,
  type ToggleGroupProps,
  type ToggleGroupItemProps,
  type ToggleGroupContextValue,
} from './ToggleGroup.js';

// PinInput
export {
  PinInput,
  PinInputInput,
  type PinInputProps,
  type PinInputInputProps,
  type PinInputContextValue,
} from './PinInput.js';

// TimePicker
export {
  TimePicker,
  TimePickerTrigger,
  TimePickerContent,
  TimePickerColumn,
  TimePickerItem,
  type TimePickerProps,
  type TimePickerTriggerProps,
  type TimePickerContentProps,
  type TimePickerColumnProps,
  type TimePickerItemProps,
  type TimePickerContextValue,
  type TimeValue,
} from './TimePicker.js';

// DateRangePicker
export {
  DateRangePicker,
  DateRangePickerTrigger,
  DateRangePickerContent,
  DateRangePickerCalendar,
  DateRangePickerPreset,
  type DateRangePickerProps,
  type DateRangePickerTriggerProps,
  type DateRangePickerContentProps,
  type DateRangePickerCalendarProps,
  type DateRangePickerPresetProps,
  type DateRangePickerContextValue,
  type DateRange,
} from './DateRangePicker.js';

// FileUpload
export {
  FileUpload,
  FileUploadTrigger,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemRemove,
  type FileUploadProps,
  type FileUploadTriggerProps,
  type FileUploadDropzoneProps,
  type FileUploadItemProps,
  type FileUploadItemRemoveProps,
  type FileUploadContextValue,
  type FileWithPreview,
  type FileRejection,
} from './FileUpload.js';

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
