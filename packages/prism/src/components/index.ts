/**
 * Prism Component Exports
 *
 * @module @omnitron-dev/prism/components
 */

// Admin Filters & Tables
export {
  FilterToolbar,
  AdminDataTable,
  StatusChip,
  AmountCell,
  type FilterConfig,
  type FilterValues,
  type FilterOption,
  type FilterToolbarProps,
  type FilterType,
  type ColumnDef,
  type AdminDataTableProps,
  type StatusChipProps,
  type StatusColor,
  type AmountCellProps,
} from './admin-filters/index.js';

// Date Range Picker
export {
  DateRangePicker,
  DateRangeInput,
  useDateRangePicker,
  parseDateString,
  formatDateString,
  type DateRangePickerProps,
  type DateRangeInputProps,
  type DateRangeValue,
  type UseDateRangePickerReturn,
} from './date-range-picker/index.js';

// Animate
export {
  AnimateBorder,
  animateBorderClasses,
  MotionLazy,
  type AnimateBorderProps,
  type MotionLazyProps,
} from './animate/index.js';

// Avatar
export {
  Avatar,
  CustomAvatarGroup,
  type AvatarProps,
  type AvatarSize,
  type AvatarShape,
  type CustomAvatarGroupProps,
} from './avatar/index.js';

// Badge
export {
  Badge,
  CountBadge,
  StatusDot,
  type BadgeProps,
  type BadgeSize,
  type BadgeVariant,
  type BadgeColor,
  type CountBadgeProps,
  type StatusDotProps,
  type StatusDotStatus,
} from './badge/index.js';

// Card
export {
  Card,
  CardSection,
  StatCard,
  type CardProps,
  type CardVariant,
  type CardSectionProps,
  type StatCardProps,
} from './card/index.js';

// Confirm Dialog
export {
  ConfirmDialog,
  DeleteDialog,
  type ConfirmDialogProps,
  type DeleteDialogProps,
} from './confirm-dialog/index.js';

// Empty Content
export {
  EmptyContent,
  SearchEmptyContent,
  LoadingEmptyContent,
  type EmptyContentProps,
} from './empty-content/index.js';

// Page Content
export {
  PageContent,
  CardGrid,
  type PageContentProps,
  type CardGridProps,
} from './page-content/index.js';

// Image
export { Image, ImageWithDefault, type ImageProps, type AspectRatio } from './image/index.js';

// Label
export {
  Label,
  StatusLabel,
  BooleanLabel,
  type LabelColor,
  type LabelVariant,
  type LabelProps,
} from './label/index.js';

// Loading Screen
export {
  LoadingScreen,
  SplashScreen,
  Spinner,
  type LoadingScreenProps,
  type SplashScreenProps,
  type SpinnerProps,
} from './loading-screen/index.js';

// Popover
export {
  CustomPopover,
  usePopover,
  type CustomPopoverProps,
  type PopoverArrowProps,
  type ArrowPlacement,
  type UsePopoverReturn,
} from './popover/index.js';

// Search Input
export { SearchInput, type SearchInputProps } from './search-input/index.js';

// Scrollbar
export { Scrollbar, type ScrollbarProps } from './scrollbar/index.js';

// Snackbar
export {
  SnackbarProvider,
  SimpleSnackbar,
  useSnackbar,
  type SnackbarOptions,
  type SnackbarContextValue,
  type SnackbarProviderProps,
  type SimpleSnackbarProps,
} from './snackbar/index.js';

// SvgColor
export { SvgColor, createIconComponent, type SvgColorProps, type IconProps } from './svg-color/index.js';

// Table
export {
  Table,
  useTable,
  type TableProps,
  type TableColumn,
  type SortOrder,
  type UseTableOptions,
  type UseTableReturn,
} from './table/index.js';

// Field (React Hook Form Integration)
export {
  // Field namespace
  Field,
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
  FieldEditor,
  FieldCustomEditor,
  // Base field types
  type FieldTextProps,
  type FieldSelectProps,
  type FieldCheckboxProps,
  type FieldSwitchProps,
  type FieldNumberProps,
  type FieldRadioProps,
  type RadioOption,
  type FieldAutocompleteProps,
  type AutocompleteOption,
  type FieldMultiSelectProps,
  type MultiSelectOption,
  type FieldRatingProps,
  type FieldSliderProps,
  type FieldDatePickerProps,
  // New field types (v0.4.0)
  type FieldTimePickerProps,
  type FieldDateTimePickerProps,
  type FieldMultiCheckboxProps,
  type MultiCheckboxOption,
  type FieldMultiSwitchProps,
  type MultiSwitchOption,
  type FieldCodeProps,
  type FieldUploadProps,
  type FieldUploadBoxProps,
  type FieldUploadAvatarProps,
  type FileValue,
  type UploadValue,
  type FieldPhoneProps,
  type CountryData,
  type FieldCountrySelectProps,
  type Country,
  type FieldEditorProps,
  type FieldCustomEditorProps,
  type EditorRenderProps,
  type EditorToolbarConfig,
} from './field/index.js';

// Skeleton
export {
  Skeleton,
  CardSkeleton,
  TableSkeleton,
  type SkeletonProps,
  type SkeletonVariant,
  type CardSkeletonProps,
  type TableSkeletonProps,
} from './skeleton/index.js';

// Progress
export {
  LinearProgress,
  CircularProgress,
  ProgressBar,
  type ProgressColor,
  type LinearProgressProps,
  type CircularProgressProps,
  type ProgressBarProps,
} from './progress/index.js';

// Tabs
export {
  Tabs,
  TabPanel,
  useTabs,
  type TabsProps,
  type TabItem,
  type TabPanelProps,
  type UseTabsOptions,
  type UseTabsReturn,
} from './tabs/index.js';

// Accordion
export {
  Accordion,
  SimpleAccordion,
  useAccordion,
  type AccordionProps,
  type AccordionItem,
  type SimpleAccordionProps,
  type UseAccordionOptions,
  type UseAccordionReturn,
} from './accordion/index.js';

// Menu
export {
  Menu,
  useMenu,
  ContextMenu,
  type MenuProps,
  type MenuItemDef,
  type MenuItemType,
  type UseMenuReturn,
  type ContextMenuProps,
} from './menu/index.js';

// Navigation Progress
export { NavigationProgress, type NavigationProgressProps } from './navigation-progress/index.js';

// Scroll To Top
export { ScrollToTop, type ScrollToTopProps } from './scroll-to-top/index.js';

// Error Boundary
export {
  ErrorBoundary,
  useErrorBoundary,
  parseStackTrace,
  getErrorLocation,
  type ErrorBoundaryProps,
  type FallbackProps,
  type StackFrame,
  type ParsedStackTrace,
} from './error-boundary/index.js';

// Settings
export {
  SettingsProvider,
  SettingsDrawer,
  useSettings,
  useSettingsDrawer,
  type SettingsProviderProps,
  type SettingsContextValue,
  type SettingsDrawerState,
  type SettingsDrawerProps,
  type SettingsSection,
} from './settings/index.js';

// Tooltip
export { Tooltip, type TooltipProps } from './tooltip/index.js';

// Alert
export {
  Alert,
  InlineAlert,
  type AlertProps,
  type AlertSeverity,
  type AlertVariant,
  type InlineAlertProps,
} from './alert/index.js';

// Breadcrumbs
export {
  Breadcrumbs,
  type BreadcrumbsProps,
  type BreadcrumbLinkProps,
  type BreadcrumbsSlots,
  type BreadcrumbsSlotProps,
  type MoreLinksProps,
} from './breadcrumbs/index.js';

// Drawer
export { Drawer, type DrawerProps, type DrawerAnchor } from './drawer/index.js';

// Stepper
export {
  Stepper,
  StepperActions,
  useStepper,
  type StepperProps,
  type StepItem,
  type UseStepperReturn,
  type UseStepperOptions,
  type StepperActionsProps,
} from './stepper/index.js';

// Chart
export {
  Chart,
  useChart,
  ChartLoading,
  ChartLegends,
  chartClasses,
  type ChartProps,
  type ChartOptions,
  type ChartSeries,
  type ChartType,
  type ChartLoadingProps,
  type ChartLegendsProps,
} from './chart/index.js';

// Lightbox
export {
  Lightbox,
  useLightbox,
  lightboxClasses,
  type LightboxProps,
  type LightboxSlide,
  type LightboxToolbarProps,
  type LightboxThumbnailsProps,
  type UseLightboxReturn,
  type UseLightboxOptions,
} from './lightbox/index.js';

// Carousel
export {
  Carousel,
  useCarousel,
  carouselClasses,
  type CarouselProps,
  type CarouselSlide as CarouselSlideType,
  type CarouselBreakpoint,
  type CarouselArrowProps,
  type CarouselDotsProps,
  type UseCarouselReturn,
  type UseCarouselOptions,
} from './carousel/index.js';

// NavSection
export {
  // Components
  NavSection,
  NavSectionVertical,
  NavSectionHorizontal,
  NavSectionMini,
  NavItem,
  NavList,
  NavSubList,
  Nav,
  NavUl,
  NavLi,
  NavSubheader,
  NavItemBase,
  NavIcon,
  NavTexts,
  NavArrow,
  NavInfo,
  // Styles
  navSectionClasses,
  navSectionCssVars,
  getNavCssVars,
  // Types
  type NavItemRenderProps,
  type NavItemStateProps,
  type NavItemSlotProps,
  type NavSlotProps,
  type NavItemOptionsProps,
  type NavItemDataProps,
  type NavItemProps,
  type NavListProps,
  type NavSubListProps,
  type NavGroupProps,
  type NavSectionData,
  type NavSectionProps,
  type NavVariant,
  type NavCommonProps,
  type NavUlProps,
  type NavLiProps,
  type NavSubheaderProps,
  type NavItemBaseProps,
  type NavIconProps,
  type NavTextsProps,
  type NavArrowProps,
  type NavInfoProps,
} from './nav-section/index.js';

// Editor (TipTap)
export {
  Editor,
  editorClasses,
  resolveToolbar,
  type EditorProps,
  type ToolbarPreset,
  type ToolbarItem as EditorToolbarItem,
  type ToolbarConfig,
  type ResolvedToolbar,
  type EditorToolbarProps,
  type EditorToolbarItemProps,
} from './editor/index.js';

// MegaMenu
export {
  // Components
  MegaMenu,
  MegaMenuHorizontal,
  MegaMenuVertical,
  MegaMenuMobile,
  // Styles
  megaMenuClasses,
  megaMenuCssVars,
  // Types
  type MegaMenuRenderProps,
  type MegaMenuItemStateProps,
  type MegaMenuItemSlotProps,
  type MegaMenuSlotProps,
  type MegaMenuSlide,
  type MegaMenuTag,
  type MegaMenuMoreLink,
  type MegaMenuChildItem,
  type MegaMenuChildSection,
  type MegaMenuItemOptionsProps,
  type MegaMenuItemDataProps,
  type MegaMenuItemProps,
  type MegaMenuSubItemProps,
  type MegaMenuListProps,
  type MegaMenuSubListProps,
  type MegaMenuVariant,
  type MegaMenuProps,
} from './mega-menu/index.js';

// ScrollSpy
export { ScrollSpyProvider, useScrollSpy, ScrollSpySection } from './scroll-spy/index.js';

// DocLayout
export { DocLayout, DocSidebar, DocSectionNav, type DocSidebarItem, type DocHeading } from './doc-layout/index.js';

// TipTapRenderer
export {
  TipTapRenderer,
  registerTipTapNode,
  type TipTapRendererProps,
  type TipTapDoc,
  type TipTapNode,
  type TipTapMark,
} from './tiptap-renderer/index.js';

// ContentRenderer (unified TipTap + Markdown)
export {
  ContentRenderer,
  Markdown,
  ContentRoot,
  contentClasses,
  htmlToMarkdown,
  isMarkdownContent,
  type ContentRendererProps,
  type ContentValue,
  type MarkdownProps,
} from './content-renderer/index.js';

// Duration Picker
export { DurationPicker, type DurationPickerProps, type DurationPickerLabels } from './duration-picker/index.js';

// Changelog
export { ChangelogTimeline, ChangelogEntry } from './changelog/index.js';
