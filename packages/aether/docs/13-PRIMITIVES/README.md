# 13. UI Primitives - Headless Component Library

> **Status**: Complete Specification
> **Last Updated**: 2025-10-06
> **Part of**: Aether Frontend Framework Specification

---

## Navigation

This document has been split into organized sections for better navigation and maintainability.

### 📘 Introduction

Foundational concepts and architecture:

- [01-Philosophy.md](./00-Introduction/01-Philosophy.md) - Why headless components, design philosophy, inspiration
- [02-Architecture.md](./00-Introduction/02-Architecture.md) - Component structure, state management, context system
- [03-Accessibility.md](./00-Introduction/03-Accessibility.md) - WAI-ARIA compliance, keyboard navigation, focus management, screen reader support

### 🎭 Primitives by Category

#### 01. Overlays & Dialogs

Components for modal and popup interactions:

- [Dialog.md](./01-Overlays/Dialog.md) - Modal dialogs with focus trapping
- [Popover.md](./01-Overlays/Popover.md) - Floating content containers
- [DropdownMenu.md](./01-Overlays/DropdownMenu.md) - Contextual dropdown menus
- [AlertDialog.md](./01-Overlays/AlertDialog.md) - Critical action confirmations
- [Sheet.md](./01-Overlays/Sheet.md) - Side panels and drawers
- [Drawer.md](./01-Overlays/Drawer.md) - Sliding panels from edges
- [Popconfirm.md](./01-Overlays/Popconfirm.md) - Quick confirmation popovers

#### 02. Navigation

Components for site and content navigation:

- [Tabs.md](./02-Navigation/Tabs.md) - Tab-based content switching
- [Accordion.md](./02-Navigation/Accordion.md) - Collapsible content sections
- [NavigationMenu.md](./02-Navigation/NavigationMenu.md) - Complex navigation structures
- [Breadcrumb.md](./02-Navigation/Breadcrumb.md) - Hierarchical navigation trails
- [Pagination.md](./02-Navigation/Pagination.md) - Page navigation controls
- [Menubar.md](./02-Navigation/Menubar.md) - Application menu bars
- [Stepper.md](./02-Navigation/Stepper.md) - Multi-step process navigation

#### 03. Forms & Inputs

Form controls and data entry components (30 primitives):

**Basic Inputs**
- [Input.md](./03-Forms/Input.md) - Text input fields
- [Textarea.md](./03-Forms/Textarea.md) - Multi-line text areas
- [Label.md](./03-Forms/Label.md) - Form field labels
- [NumberInput.md](./03-Forms/NumberInput.md) - Numeric input with controls
- [PinInput.md](./03-Forms/PinInput.md) - PIN/OTP code input

**Selection Controls**
- [Select.md](./03-Forms/Select.md) - Dropdown selection lists
- [Combobox.md](./03-Forms/Combobox.md) - Searchable select with autocomplete
- [MultiSelect.md](./03-Forms/MultiSelect.md) - Multiple value selection
- [RadioGroup.md](./03-Forms/RadioGroup.md) - Mutually exclusive options
- [CheckboxGroup.md](./03-Forms/CheckboxGroup.md) - Multiple checkboxes
- [ToggleGroup.md](./03-Forms/ToggleGroup.md) - Toggle button groups
- [Switch.md](./03-Forms/Switch.md) - Boolean toggle switch
- [Toggle.md](./03-Forms/Toggle.md) - Simple toggle button

**Range & Sliders**
- [Slider.md](./03-Forms/Slider.md) - Single value sliders
- [RangeSlider.md](./03-Forms/RangeSlider.md) - Range selection sliders
- [Rating.md](./03-Forms/Rating.md) - Star ratings

**Date & Time**
- [DatePicker.md](./03-Forms/DatePicker.md) - Date selection
- [Calendar.md](./03-Forms/Calendar.md) - Calendar grid
- [DateRangePicker.md](./03-Forms/DateRangePicker.md) - Date range selection
- [TimePicker.md](./03-Forms/TimePicker.md) - Time selection

**Advanced Inputs**
- [FileUpload.md](./03-Forms/FileUpload.md) - File upload controls
- [TagsInput.md](./03-Forms/TagsInput.md) - Tag/chip input
- [ColorPicker.md](./03-Forms/ColorPicker.md) - Color selection
- [Editable.md](./03-Forms/Editable.md) - Inline editable text
- [Mentions.md](./03-Forms/Mentions.md) - @mention autocomplete
- [Transfer.md](./03-Forms/Transfer.md) - Dual list selection

**Form Structure**
- [Form.md](./03-Forms/Form.md) - Form validation and submission

#### 04. Layout

Layout and spacing primitives (14 primitives):

**Containers**
- [Box.md](./04-Layout/Box.md) - Universal layout box
- [Container.md](./04-Layout/Container.md) - Responsive content containers
- [Flex.md](./04-Layout/Flex.md) - Flexbox layouts
- [Grid.md](./04-Layout/Grid.md) - CSS Grid layouts
- [Stack.md](./04-Layout/Stack.md) - Vertical/horizontal stacks
- [SimpleGrid.md](./04-Layout/SimpleGrid.md) - Responsive grid with equal columns
- [Masonry.md](./04-Layout/Masonry.md) - Masonry grid layouts

**Spacing & Alignment**
- [Space.md](./04-Layout/Space.md) - Flexible spacing between elements
- [Spacer.md](./04-Layout/Spacer.md) - Flex-grow based spacers
- [Center.md](./04-Layout/Center.md) - Center content vertically/horizontally
- [Divider.md](./04-Layout/Divider.md) - Visual content separators
- [Separator.md](./04-Layout/Separator.md) - Semantic separators

**Scrolling & Ratios**
- [ScrollArea.md](./04-Layout/ScrollArea.md) - Custom scrollable areas
- [AspectRatio.md](./04-Layout/AspectRatio.md) - Aspect ratio containers

#### 05. Display

Content display components (8 primitives):

- [Avatar.md](./05-Display/Avatar.md) - User avatars with fallbacks
- [Badge.md](./05-Display/Badge.md) - Labels and status indicators
- [Table.md](./05-Display/Table.md) - Data tables
- [Carousel.md](./05-Display/Carousel.md) - Image/content carousels
- [Tree.md](./05-Display/Tree.md) - Hierarchical tree views
- [Empty.md](./05-Display/Empty.md) - Empty state placeholders
- [Timeline.md](./05-Display/Timeline.md) - Timeline visualization
- [Image.md](./05-Display/Image.md) - Image with loading states

#### 06. Feedback

User feedback and loading states (5 primitives):

- [Progress.md](./06-Feedback/Progress.md) - Progress bars and indicators
- [Toast.md](./06-Feedback/Toast.md) - Toast notifications
- [Skeleton.md](./06-Feedback/Skeleton.md) - Loading skeletons
- [Spinner.md](./06-Feedback/Spinner.md) - Loading spinners
- [Notification.md](./06-Feedback/Notification.md) - System notifications

#### 07. Utilities

Utility components (3 primitives):

- [Collapsible.md](./07-Utilities/Collapsible.md) - Expandable content regions
- [Resizable.md](./07-Utilities/Resizable.md) - Resizable panels
- [Affix.md](./07-Utilities/Affix.md) - Fixed position elements

#### 08. Advanced

Advanced/specialized components (2 primitives):

- [CommandPalette.md](./08-Advanced/CommandPalette.md) - Command palette interface
- [VirtualList.md](./08-Advanced/VirtualList.md) - Virtualized scrolling lists

### 🎨 Patterns & Best Practices

Advanced topics and implementation patterns:

- [01-Composition-Patterns.md](./90-Patterns/01-Composition-Patterns.md) - Building complex UIs, layout composition, primitive composition rules
- [02-Customization.md](./90-Patterns/02-Customization.md) - Styling strategies, styled wrapper components
- [03-Theme-Integration.md](./90-Patterns/03-Theme-Integration.md) - Theme system integration
- [04-Animation-System.md](./90-Patterns/04-Animation-System.md) - Data-state animations, animation helpers
- [05-Testing-Primitives.md](./90-Patterns/05-Testing-Primitives.md) - Unit testing, accessibility testing
- [06-Advanced-Patterns.md](./90-Patterns/06-Advanced-Patterns.md) - Custom primitives, polymorphic components
- [07-Best-Practices.md](./90-Patterns/07-Best-Practices.md) - Labels, controlled state, keyboard navigation, mobile support
- [08-Summary.md](./90-Patterns/08-Summary.md) - Document summary

---

## Quick Stats

- **Total Primitives**: 82
- **Categories**: 8 (Overlays, Navigation, Forms, Layout, Display, Feedback, Utilities, Advanced)
- **Documentation Status**: Complete
- **Test Coverage**: Expanding (see [PRIMITIVES-AUDIT.md](../PRIMITIVES-AUDIT.md))

## Related Documentation

- [PRIMITIVES-AUDIT.md](../PRIMITIVES-AUDIT.md) - Current implementation status and test coverage
- [12-ROUTING.md](../12-ROUTING.md) - File-based routing system
- [14-ISLANDS.md](../14-ISLANDS.md) - Islands architecture for partial hydration
- [15-SSR-SSG.md](../15-SSR-SSG.md) - Server-side rendering and static site generation

---

*This modular structure allows easier navigation, maintenance, and contribution to individual primitives.*
