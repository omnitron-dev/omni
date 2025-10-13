/**
 * Styled CommandPalette Component
 *
 * Command palette for quick actions and search.
 * Built on top of the CommandPalette primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  CommandPalette as CommandPalettePrimitive,
  CommandPaletteInput as CommandPaletteInputPrimitive,
  CommandPaletteList as CommandPaletteListPrimitive,
  CommandPaletteItem as CommandPaletteItemPrimitive,
  CommandPaletteGroup as CommandPaletteGroupPrimitive,
  CommandPaletteSeparator as CommandPaletteSeparatorPrimitive,
  CommandPaletteEmpty as CommandPaletteEmptyPrimitive,
  type CommandPaletteProps as CommandPalettePrimitiveProps,
} from '../../primitives/CommandPalette.js';

/**
 * CommandPalette - Root component
 */
export const CommandPalette = styled(CommandPalettePrimitive, {
  base: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: '600px',
    backgroundColor: '#ffffff',
    borderRadius: '0.75rem',
    border: '1px solid #e5e7eb',
    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    overflow: 'hidden',
  },
});

/**
 * CommandPaletteInput - Search input
 */
export const CommandPaletteInput = styled(CommandPaletteInputPrimitive, {
  base: {
    width: '100%',
    padding: '1rem 1.25rem',
    fontSize: '1rem',
    lineHeight: '1.5',
    border: 'none',
    borderBottom: '1px solid #e5e7eb',
    backgroundColor: 'transparent',
    color: '#111827',
    '&:focus': {
      outline: 'none',
    },
    '&::placeholder': {
      color: '#9ca3af',
    },
  },
});

/**
 * CommandPaletteList - Items list container
 */
export const CommandPaletteList = styled(CommandPaletteListPrimitive, {
  base: {
    maxHeight: '400px',
    overflowY: 'auto',
    padding: '0.5rem',
  },
});

/**
 * CommandPaletteItem - Command item
 */
export const CommandPaletteItem = styled(CommandPaletteItemPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
    fontSize: '0.875rem',
    lineHeight: '1.25',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'all 0.1s ease',
    color: '#111827',
    '&:hover': {
      backgroundColor: '#f3f4f6',
    },
    '&[data-selected]': {
      backgroundColor: '#eff6ff',
      color: '#1e40af',
    },
    '&[data-disabled]': {
      opacity: '0.5',
      pointerEvents: 'none',
    },
  },
});

/**
 * CommandPaletteGroup - Command group
 */
export const CommandPaletteGroup = styled(CommandPaletteGroupPrimitive, {
  base: {
    padding: '0.5rem 0',
    '[data-command-group-heading]': {
      padding: '0.5rem 1rem',
      fontSize: '0.75rem',
      fontWeight: '600',
      color: '#6b7280',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    },
  },
});

/**
 * CommandPaletteSeparator - Visual separator
 */
export const CommandPaletteSeparator = styled(CommandPaletteSeparatorPrimitive, {
  base: {
    height: '1px',
    backgroundColor: '#e5e7eb',
    margin: '0.5rem 0',
  },
});

/**
 * CommandPaletteEmpty - Empty state
 */
export const CommandPaletteEmpty = styled(CommandPaletteEmptyPrimitive, {
  base: {
    padding: '2rem',
    textAlign: 'center',
    fontSize: '0.875rem',
    color: '#6b7280',
  },
});

// Attach sub-components
(CommandPalette as any).Input = CommandPaletteInput;
(CommandPalette as any).List = CommandPaletteList;
(CommandPalette as any).Item = CommandPaletteItem;
(CommandPalette as any).Group = CommandPaletteGroup;
(CommandPalette as any).Separator = CommandPaletteSeparator;
(CommandPalette as any).Empty = CommandPaletteEmpty;

// Display names
CommandPalette.displayName = 'CommandPalette';
CommandPaletteInput.displayName = 'CommandPaletteInput';
CommandPaletteList.displayName = 'CommandPaletteList';
CommandPaletteItem.displayName = 'CommandPaletteItem';
CommandPaletteGroup.displayName = 'CommandPaletteGroup';
CommandPaletteSeparator.displayName = 'CommandPaletteSeparator';
CommandPaletteEmpty.displayName = 'CommandPaletteEmpty';

// Type exports
export type { CommandPalettePrimitiveProps as CommandPaletteProps };
