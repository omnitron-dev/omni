/**
 * Theme Picker Component
 * UI component for selecting and previewing themes
 */

import { defineComponent } from '../../../core/component';
import { createSignal } from '../../../core/reactivity/signal';
import { effect as createEffect } from '../../../core/reactivity/effect';
import type { Theme, ThemePreview } from './types';
import { getThemeManager } from './ThemeManager';

/**
 * Theme Picker Props
 */
export interface ThemePickerProps {
  themes?: Theme[];
  currentTheme?: string;
  showPreview?: boolean;
  onChange?: (themeName: string) => void;
}

/**
 * Generate theme preview data
 */
function generateThemePreview(theme: Theme): ThemePreview {
  return {
    id: theme.metadata.name,
    name: theme.metadata.displayName,
    colors: {
      primary: theme.colors.primary,
      background: theme.colors.background,
      text: theme.colors.text,
      border: theme.colors.border,
    },
  };
}

/**
 * Theme Picker Component
 * Displays a list of themes with live previews
 */
export const ThemePicker = defineComponent<ThemePickerProps>(
  ({ themes = [], currentTheme, showPreview = true, onChange }) => {
    const themeManager = getThemeManager();
    const selectedTheme = createSignal(currentTheme || themeManager.currentTheme || '');
    const hoveredTheme = createSignal<string | null>(null);
    const isOpen = createSignal(false);

    // Available themes
    const availableThemes = themes.length > 0 ? themes : themeManager.getAllThemes();
    const themePreviews = availableThemes.map(generateThemePreview);

    // Sync with external currentTheme changes
    createEffect(() => {
      if (currentTheme) {
        selectedTheme.value = currentTheme;
      }
    });

    /**
     * Handle theme selection
     */
    const handleThemeSelect = (themeName: string) => {
      selectedTheme.value = themeName;
      themeManager.applyTheme(themeName);

      if (onChange) {
        onChange(themeName);
      }

      // Close picker
      isOpen.value = false;
    };

    /**
     * Handle theme hover for preview
     */
    const handleThemeHover = (themeName: string | null) => {
      if (showPreview) {
        hoveredTheme.value = themeName;
      }
    };

    /**
     * Toggle picker open state
     */
    const togglePicker = () => {
      isOpen.value = !isOpen.value;
    };

    /**
     * Render theme preview card
     */
    const renderThemePreview = (preview: ThemePreview) => {
      const isSelected = selectedTheme.value === preview.id;
      const isHovered = hoveredTheme.value === preview.id;

      return `
        <div
          class="theme-picker__item ${isSelected ? 'is-selected' : ''} ${isHovered ? 'is-hovered' : ''}"
          data-theme-id="${preview.id}"
          role="button"
          tabindex="0"
          aria-label="Select ${preview.name} theme"
          aria-pressed="${isSelected}"
        >
          <div class="theme-picker__preview" style="
            --preview-primary: ${preview.colors.primary};
            --preview-background: ${preview.colors.background};
            --preview-text: ${preview.colors.text};
            --preview-border: ${preview.colors.border};
          ">
            <div class="theme-preview__toolbar" style="background-color: ${preview.colors.background}; border-bottom: 1px solid ${preview.colors.border};">
              <div class="theme-preview__button" style="background-color: ${preview.colors.primary};"></div>
              <div class="theme-preview__button" style="background-color: ${preview.colors.primary};"></div>
              <div class="theme-preview__button" style="background-color: ${preview.colors.primary};"></div>
            </div>
            <div class="theme-preview__content" style="background-color: ${preview.colors.background}; color: ${preview.colors.text};">
              <div class="theme-preview__line" style="background-color: ${preview.colors.text}; opacity: 0.8;"></div>
              <div class="theme-preview__line" style="background-color: ${preview.colors.text}; opacity: 0.6;"></div>
              <div class="theme-preview__line" style="background-color: ${preview.colors.text}; opacity: 0.4; width: 60%;"></div>
            </div>
          </div>
          <div class="theme-picker__name">${preview.name}</div>
          ${isSelected ? '<div class="theme-picker__check">✓</div>' : ''}
        </div>
      `;
    };

    /**
     * Render the component
     */
    const render = () => {
      const currentThemeName = availableThemes.find(
        t => t.metadata.name === selectedTheme.value
      )?.metadata.displayName || 'Select Theme';

      return `
        <div class="theme-picker">
          <button
            class="theme-picker__trigger"
            aria-expanded="${isOpen.value}"
            aria-haspopup="true"
          >
            <span class="theme-picker__label">${currentThemeName}</span>
            <svg class="theme-picker__arrow" width="12" height="12" viewBox="0 0 12 12">
              <path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>

          ${isOpen.value ? `
            <div class="theme-picker__dropdown" role="menu">
              <div class="theme-picker__grid">
                ${themePreviews.map(renderThemePreview).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    };

    // Attach event listeners after render
    const attachEvents = (element: HTMLElement) => {
      // Trigger button
      const trigger = element.querySelector('.theme-picker__trigger');
      if (trigger) {
        trigger.addEventListener('click', togglePicker);
      }

      // Theme items
      const themeItems = element.querySelectorAll('.theme-picker__item');
      themeItems.forEach(item => {
        const themeId = item.getAttribute('data-theme-id');
        if (!themeId) return;

        // Click/Enter to select
        item.addEventListener('click', () => handleThemeSelect(themeId));
        item.addEventListener('keydown', (e) => {
          if (e instanceof KeyboardEvent && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            handleThemeSelect(themeId);
          }
        });

        // Hover for preview
        item.addEventListener('mouseenter', () => handleThemeHover(themeId));
        item.addEventListener('mouseleave', () => handleThemeHover(null));
      });

      // Close on outside click
      const handleOutsideClick = (e: Event) => {
        if (!element.contains(e.target as Node)) {
          isOpen.value = false;
        }
      };

      if (isOpen.value) {
        document.addEventListener('click', handleOutsideClick);
        // Cleanup on next render
        setTimeout(() => {
          document.removeEventListener('click', handleOutsideClick);
        }, 0);
      }
    };

    // Return render function that creates DOM and attaches events
    return () => {
      const html = render();

      // Create a container element
      const container = document.createElement('div');
      container.innerHTML = html;
      const element = container.firstElementChild as HTMLElement;

      // Attach events using effect (runs after DOM is attached)
      createEffect(() => {
        if (element && element.isConnected) {
          attachEvents(element);
        }
      });

      return element;
    };
  }
);

/**
 * Theme Picker Styles
 */
export const themePickerStyles = `
.theme-picker {
  position: relative;
  display: inline-block;
}

.theme-picker__trigger {
  display: flex;
  align-items: center;
  gap: var(--editor-spacing-sm);
  padding: var(--editor-spacing-sm) var(--editor-spacing-md);
  background-color: var(--editor-color-surface);
  color: var(--editor-color-text);
  border: 1px solid var(--editor-color-border);
  border-radius: var(--editor-radius-base);
  font-family: var(--editor-font-family);
  font-size: var(--editor-font-size-sm);
  cursor: pointer;
  transition: all var(--editor-duration-fast) var(--editor-easing-out);
}

.theme-picker__trigger:hover {
  background-color: var(--editor-color-surface-hover);
  border-color: var(--editor-color-border-hover);
}

.theme-picker__trigger[aria-expanded="true"] .theme-picker__arrow {
  transform: rotate(180deg);
}

.theme-picker__label {
  font-weight: var(--editor-font-weight-medium);
}

.theme-picker__arrow {
  transition: transform var(--editor-duration-fast) var(--editor-easing-out);
}

.theme-picker__dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: var(--editor-spacing-xs);
  min-width: 500px;
  background-color: var(--editor-dropdown-bg);
  border: 1px solid var(--editor-dropdown-border);
  border-radius: var(--editor-dropdown-radius);
  box-shadow: var(--editor-dropdown-shadow);
  padding: var(--editor-spacing-md);
  z-index: var(--editor-z-dropdown);
  animation: slideDown var(--editor-duration-fast) var(--editor-easing-out);
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.theme-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--editor-spacing-md);
}

.theme-picker__item {
  position: relative;
  cursor: pointer;
  border: 2px solid transparent;
  border-radius: var(--editor-radius-base);
  padding: var(--editor-spacing-sm);
  transition: all var(--editor-duration-fast) var(--editor-easing-out);
}

.theme-picker__item:hover {
  border-color: var(--editor-color-border-hover);
  transform: translateY(-2px);
}

.theme-picker__item.is-selected {
  border-color: var(--editor-color-primary);
  box-shadow: 0 0 0 1px var(--editor-color-primary);
}

.theme-picker__item:focus-visible {
  outline: 2px solid var(--editor-color-focus);
  outline-offset: 2px;
}

.theme-picker__preview {
  border: 1px solid var(--editor-color-border);
  border-radius: var(--editor-radius-sm);
  overflow: hidden;
  margin-bottom: var(--editor-spacing-xs);
  height: 80px;
  display: flex;
  flex-direction: column;
}

.theme-preview__toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  height: 24px;
}

.theme-preview__button {
  width: 16px;
  height: 12px;
  border-radius: 2px;
}

.theme-preview__content {
  flex: 1;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.theme-preview__line {
  height: 4px;
  border-radius: 2px;
  width: 100%;
}

.theme-picker__name {
  font-size: var(--editor-font-size-sm);
  font-weight: var(--editor-font-weight-medium);
  text-align: center;
  color: var(--editor-color-text);
}

.theme-picker__check {
  position: absolute;
  top: var(--editor-spacing-sm);
  right: var(--editor-spacing-sm);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--editor-color-primary);
  color: var(--editor-color-text-inverse);
  border-radius: var(--editor-radius-full);
  font-weight: var(--editor-font-weight-bold);
  font-size: var(--editor-font-size-xs);
}

/* Responsive */
@media (max-width: 768px) {
  .theme-picker__dropdown {
    min-width: 300px;
    max-width: calc(100vw - 2 * var(--editor-spacing-md));
  }

  .theme-picker__grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: var(--editor-spacing-sm);
  }
}
`;
