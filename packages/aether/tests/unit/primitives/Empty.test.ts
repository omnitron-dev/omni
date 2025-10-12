/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription, EmptyActions } from '../../../src/primitives/Empty.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Empty', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Empty Root - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => Empty({ children: 'No data' });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('div[data-empty]');
      expect(emptyEl).toBeTruthy();
      expect(emptyEl?.textContent).toBe('No data');
    });

    it('should have data-empty attribute', () => {
      const component = () => Empty({});

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('div') as HTMLElement;
      expect(emptyEl.hasAttribute('data-empty')).toBe(true);
      expect(emptyEl.getAttribute('data-empty')).toBe('');
    });

    it('should have default variant "no-data"', () => {
      const component = () => Empty({});

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]') as HTMLElement;
      expect(emptyEl.getAttribute('data-variant')).toBe('no-data');
    });

    it('should support variant="no-results"', () => {
      const component = () => Empty({ variant: 'no-results' });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]') as HTMLElement;
      expect(emptyEl.getAttribute('data-variant')).toBe('no-results');
    });

    it('should support variant="error"', () => {
      const component = () => Empty({ variant: 'error' });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]') as HTMLElement;
      expect(emptyEl.getAttribute('data-variant')).toBe('error');
    });

    it('should support variant="custom"', () => {
      const component = () => Empty({ variant: 'custom' });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]') as HTMLElement;
      expect(emptyEl.getAttribute('data-variant')).toBe('custom');
    });

    it('should render empty without children', () => {
      const component = () => Empty({});

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]');
      expect(emptyEl).toBeTruthy();
      expect(emptyEl?.textContent).toBe('');
    });

    it('should render with text content', () => {
      const component = () => Empty({ children: 'No data available' });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]');
      expect(emptyEl?.textContent).toBe('No data available');
    });

    it('should render with multiple children', () => {
      const component = () => Empty({ children: ['First', 'Second'] });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]');
      expect(emptyEl?.textContent).toContain('First');
      expect(emptyEl?.textContent).toContain('Second');
    });
  });

  describe('Accessibility - ARIA Attributes', () => {
    it('should have role="status"', () => {
      const component = () => Empty({});

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[role="status"]');
      expect(emptyEl).toBeTruthy();
    });

    it('should have aria-live="polite"', () => {
      const component = () => Empty({});

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]') as HTMLElement;
      expect(emptyEl.getAttribute('aria-live')).toBe('polite');
    });

    it('should announce changes to screen readers', () => {
      const component = () => Empty({ variant: 'no-results', children: 'No results found' });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]') as HTMLElement;
      expect(emptyEl.getAttribute('role')).toBe('status');
      expect(emptyEl.getAttribute('aria-live')).toBe('polite');
      expect(emptyEl.textContent).toBe('No results found');
    });

    it('should support custom aria-label', () => {
      const component = () =>
        Empty({
          'aria-label': 'Search returned no results',
        });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]') as HTMLElement;
      expect(emptyEl.getAttribute('aria-label')).toBe('Search returned no results');
    });
  });

  describe('EmptyIcon - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => EmptyIcon({ children: '📭' });

      const { container } = renderComponent(component);

      const iconEl = container.querySelector('div[data-empty-icon]');
      expect(iconEl).toBeTruthy();
      expect(iconEl?.textContent).toBe('📭');
    });

    it('should have data-empty-icon attribute', () => {
      const component = () => EmptyIcon({});

      const { container } = renderComponent(component);

      const iconEl = container.querySelector('div') as HTMLElement;
      expect(iconEl.hasAttribute('data-empty-icon')).toBe(true);
      expect(iconEl.getAttribute('data-empty-icon')).toBe('');
    });

    it('should have aria-hidden="true"', () => {
      const component = () => EmptyIcon({ children: '🔍' });

      const { container } = renderComponent(component);

      const iconEl = container.querySelector('[data-empty-icon]') as HTMLElement;
      expect(iconEl.getAttribute('aria-hidden')).toBe('true');
    });

    it('should render with emoji icon', () => {
      const component = () => EmptyIcon({ children: '📂' });

      const { container } = renderComponent(component);

      const iconEl = container.querySelector('[data-empty-icon]');
      expect(iconEl?.textContent).toBe('📂');
    });

    it('should render with SVG icon', () => {
      const component = () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '64');
        svg.setAttribute('height', '64');
        return EmptyIcon({ children: svg });
      };

      const { container } = renderComponent(component);

      const iconEl = container.querySelector('[data-empty-icon]');
      const svgEl = iconEl?.querySelector('svg');
      expect(svgEl).toBeTruthy();
      expect(svgEl?.getAttribute('width')).toBe('64');
    });

    it('should render empty icon container', () => {
      const component = () => EmptyIcon({});

      const { container } = renderComponent(component);

      const iconEl = container.querySelector('[data-empty-icon]');
      expect(iconEl).toBeTruthy();
      expect(iconEl?.textContent).toBe('');
    });
  });

  describe('EmptyTitle - Basic Rendering', () => {
    it('should render as an h3 element', () => {
      const component = () => EmptyTitle({ children: 'No data available' });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('h3[data-empty-title]');
      expect(titleEl).toBeTruthy();
      expect(titleEl?.textContent).toBe('No data available');
    });

    it('should have data-empty-title attribute', () => {
      const component = () => EmptyTitle({ children: 'Title' });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('h3') as HTMLElement;
      expect(titleEl.hasAttribute('data-empty-title')).toBe(true);
      expect(titleEl.getAttribute('data-empty-title')).toBe('');
    });

    it('should render empty title', () => {
      const component = () => EmptyTitle({});

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('[data-empty-title]');
      expect(titleEl).toBeTruthy();
      expect(titleEl?.textContent).toBe('');
    });

    it('should render with long title text', () => {
      const longTitle = 'We could not find any results matching your search criteria';
      const component = () => EmptyTitle({ children: longTitle });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('[data-empty-title]');
      expect(titleEl?.textContent).toBe(longTitle);
    });
  });

  describe('EmptyDescription - Basic Rendering', () => {
    it('should render as a p element', () => {
      const component = () => EmptyDescription({ children: 'Try adjusting your filters' });

      const { container } = renderComponent(component);

      const descEl = container.querySelector('p[data-empty-description]');
      expect(descEl).toBeTruthy();
      expect(descEl?.textContent).toBe('Try adjusting your filters');
    });

    it('should have data-empty-description attribute', () => {
      const component = () => EmptyDescription({ children: 'Description' });

      const { container } = renderComponent(component);

      const descEl = container.querySelector('p') as HTMLElement;
      expect(descEl.hasAttribute('data-empty-description')).toBe(true);
      expect(descEl.getAttribute('data-empty-description')).toBe('');
    });

    it('should render empty description', () => {
      const component = () => EmptyDescription({});

      const { container } = renderComponent(component);

      const descEl = container.querySelector('[data-empty-description]');
      expect(descEl).toBeTruthy();
      expect(descEl?.textContent).toBe('');
    });

    it('should render with long description text', () => {
      const longDesc =
        'There are no items to display at this time. Try creating a new item or adjusting your search filters to see more results.';
      const component = () => EmptyDescription({ children: longDesc });

      const { container } = renderComponent(component);

      const descEl = container.querySelector('[data-empty-description]');
      expect(descEl?.textContent).toBe(longDesc);
    });

    it('should render with multiple lines', () => {
      const component = () => EmptyDescription({ children: 'Line 1\nLine 2' });

      const { container } = renderComponent(component);

      const descEl = container.querySelector('[data-empty-description]');
      expect(descEl?.textContent).toContain('Line 1');
      expect(descEl?.textContent).toContain('Line 2');
    });
  });

  describe('EmptyActions - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => {
        const button = document.createElement('button');
        button.textContent = 'Reload';
        return EmptyActions({ children: button });
      };

      const { container } = renderComponent(component);

      const actionsEl = container.querySelector('div[data-empty-actions]');
      expect(actionsEl).toBeTruthy();
      expect(actionsEl?.querySelector('button')?.textContent).toBe('Reload');
    });

    it('should have data-empty-actions attribute', () => {
      const component = () => EmptyActions({});

      const { container } = renderComponent(component);

      const actionsEl = container.querySelector('div') as HTMLElement;
      expect(actionsEl.hasAttribute('data-empty-actions')).toBe(true);
      expect(actionsEl.getAttribute('data-empty-actions')).toBe('');
    });

    it('should render empty actions container', () => {
      const component = () => EmptyActions({});

      const { container } = renderComponent(component);

      const actionsEl = container.querySelector('[data-empty-actions]');
      expect(actionsEl).toBeTruthy();
      expect(actionsEl?.textContent).toBe('');
    });

    it('should render with single button', () => {
      const component = () => {
        const button = document.createElement('button');
        button.textContent = 'Retry';
        button.className = 'btn-primary';
        return EmptyActions({ children: button });
      };

      const { container } = renderComponent(component);

      const button = container.querySelector('.btn-primary');
      expect(button).toBeTruthy();
      expect(button?.textContent).toBe('Retry');
    });

    it('should render with multiple buttons', () => {
      const component = () => {
        const actions = EmptyActions({});
        const btn1 = document.createElement('button');
        btn1.textContent = 'Clear Search';
        const btn2 = document.createElement('button');
        btn2.textContent = 'View All';
        actions.appendChild(btn1);
        actions.appendChild(btn2);
        return actions;
      };

      const { container } = renderComponent(component);

      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBe(2);
      expect(buttons[0].textContent).toBe('Clear Search');
      expect(buttons[1].textContent).toBe('View All');
    });
  });

  describe('Subcomponent Attachment', () => {
    it('should attach Icon as Empty.Icon', () => {
      expect((Empty as any).Icon).toBe(EmptyIcon);
    });

    it('should attach Title as Empty.Title', () => {
      expect((Empty as any).Title).toBe(EmptyTitle);
    });

    it('should attach Description as Empty.Description', () => {
      expect((Empty as any).Description).toBe(EmptyDescription);
    });

    it('should attach Actions as Empty.Actions', () => {
      expect((Empty as any).Actions).toBe(EmptyActions);
    });

    it('should have all subcomponents accessible', () => {
      expect((Empty as any).Icon).toBeTruthy();
      expect((Empty as any).Title).toBeTruthy();
      expect((Empty as any).Description).toBeTruthy();
      expect((Empty as any).Actions).toBeTruthy();
    });
  });

  describe('Composition - Full Empty State Structure', () => {
    it('should render complete empty state with all subcomponents', () => {
      const component = () => {
        const empty = Empty({ variant: 'no-data' });
        const icon = EmptyIcon({ children: '📭' });
        const title = EmptyTitle({ children: 'No data available' });
        const description = EmptyDescription({
          children: 'There is no data to display at this time.',
        });
        const actions = EmptyActions({});
        const button = document.createElement('button');
        button.textContent = 'Load Data';

        actions.appendChild(button);
        empty.appendChild(icon);
        empty.appendChild(title);
        empty.appendChild(description);
        empty.appendChild(actions);

        return empty;
      };

      const { container } = renderComponent(component);

      expect(container.querySelector('[data-empty]')).toBeTruthy();
      expect(container.querySelector('[data-empty-icon]')).toBeTruthy();
      expect(container.querySelector('[data-empty-title]')).toBeTruthy();
      expect(container.querySelector('[data-empty-description]')).toBeTruthy();
      expect(container.querySelector('[data-empty-actions]')).toBeTruthy();
      expect(container.querySelector('button')?.textContent).toBe('Load Data');
    });

    it('should render empty state with only icon and title', () => {
      const component = () => {
        const empty = Empty({});
        const icon = EmptyIcon({ children: '🔍' });
        const title = EmptyTitle({ children: 'No results' });

        empty.appendChild(icon);
        empty.appendChild(title);

        return empty;
      };

      const { container } = renderComponent(component);

      expect(container.querySelector('[data-empty-icon]')?.textContent).toBe('🔍');
      expect(container.querySelector('[data-empty-title]')?.textContent).toBe('No results');
      expect(container.querySelector('[data-empty-description]')).toBeNull();
      expect(container.querySelector('[data-empty-actions]')).toBeNull();
    });

    it('should render empty state without icon', () => {
      const component = () => {
        const empty = Empty({});
        const title = EmptyTitle({ children: 'Empty State' });
        const description = EmptyDescription({ children: 'No data to show' });

        empty.appendChild(title);
        empty.appendChild(description);

        return empty;
      };

      const { container } = renderComponent(component);

      expect(container.querySelector('[data-empty-icon]')).toBeNull();
      expect(container.querySelector('[data-empty-title]')).toBeTruthy();
      expect(container.querySelector('[data-empty-description]')).toBeTruthy();
    });

    it('should render empty state with custom content', () => {
      const component = () => {
        const empty = Empty({ variant: 'custom' });
        const customDiv = document.createElement('div');
        customDiv.className = 'custom-empty-content';
        customDiv.textContent = 'Custom content here';

        empty.appendChild(customDiv);

        return empty;
      };

      const { container } = renderComponent(component);

      const customEl = container.querySelector('.custom-empty-content');
      expect(customEl).toBeTruthy();
      expect(customEl?.textContent).toBe('Custom content here');
    });
  });

  describe('Styling', () => {
    it('should apply class name to empty root', () => {
      const component = () => Empty({ class: 'empty-state', variant: 'no-data' });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('.empty-state');
      expect(emptyEl).toBeTruthy();
    });

    it('should apply inline styles to empty root', () => {
      const component = () =>
        Empty({
          style: {
            padding: '32px',
            textAlign: 'center',
            minHeight: '300px',
          },
        });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]') as HTMLElement;
      expect(emptyEl.style.padding).toBe('32px');
      expect(emptyEl.style.textAlign).toBe('center');
      expect(emptyEl.style.minHeight).toBe('300px');
    });

    it('should apply class to icon', () => {
      const component = () => EmptyIcon({ class: 'empty-icon-large', children: '📂' });

      const { container } = renderComponent(component);

      expect(container.querySelector('.empty-icon-large')).toBeTruthy();
    });

    it('should apply class to title', () => {
      const component = () => EmptyTitle({ class: 'empty-title-bold', children: 'Title' });

      const { container } = renderComponent(component);

      expect(container.querySelector('.empty-title-bold')).toBeTruthy();
    });

    it('should apply class to description', () => {
      const component = () => EmptyDescription({ class: 'text-muted', children: 'Description' });

      const { container } = renderComponent(component);

      expect(container.querySelector('.text-muted')).toBeTruthy();
    });

    it('should apply class to actions', () => {
      const component = () => EmptyActions({ class: 'action-buttons' });

      const { container } = renderComponent(component);

      expect(container.querySelector('.action-buttons')).toBeTruthy();
    });
  });

  describe('Props Forwarding', () => {
    it('should forward id attribute', () => {
      const component = () => Empty({ id: 'empty-state-1' });

      const { container } = renderComponent(component);

      expect(container.querySelector('#empty-state-1')).toBeTruthy();
    });

    it('should forward data attributes', () => {
      const component = () =>
        Empty({
          'data-testid': 'empty-component',
          'data-category': 'search',
        });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-testid="empty-component"]') as HTMLElement;
      expect(emptyEl).toBeTruthy();
      expect(emptyEl.getAttribute('data-category')).toBe('search');
    });

    it('should forward event handlers', () => {
      let clicked = false;
      const component = () =>
        Empty({
          onClick: () => {
            clicked = true;
          },
        });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]') as HTMLElement;
      emptyEl.click();

      expect(clicked).toBe(true);
    });
  });

  describe('Use Cases - Variants', () => {
    it('should work as no-data state', () => {
      const component = () => {
        const empty = Empty({ variant: 'no-data', class: 'no-data-state' });
        const icon = EmptyIcon({ children: '📭' });
        const title = EmptyTitle({ children: 'No data available' });
        const description = EmptyDescription({
          children: 'There is no data to display at this time.',
        });

        empty.appendChild(icon);
        empty.appendChild(title);
        empty.appendChild(description);

        return empty;
      };

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('.no-data-state') as HTMLElement;
      expect(emptyEl.getAttribute('data-variant')).toBe('no-data');
      expect(container.querySelector('[data-empty-icon]')?.textContent).toBe('📭');
      expect(container.querySelector('[data-empty-title]')?.textContent).toBe('No data available');
    });

    it('should work as no-results state', () => {
      const component = () => {
        const empty = Empty({ variant: 'no-results' });
        const icon = EmptyIcon({ children: '🔍' });
        const title = EmptyTitle({ children: 'No results found' });
        const description = EmptyDescription({
          children: 'Try adjusting your search criteria',
        });
        const actions = EmptyActions({});
        const button = document.createElement('button');
        button.textContent = 'Clear Search';

        actions.appendChild(button);
        empty.appendChild(icon);
        empty.appendChild(title);
        empty.appendChild(description);
        empty.appendChild(actions);

        return empty;
      };

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]') as HTMLElement;
      expect(emptyEl.getAttribute('data-variant')).toBe('no-results');
      expect(container.querySelector('[data-empty-icon]')?.textContent).toBe('🔍');
      expect(container.querySelector('button')?.textContent).toBe('Clear Search');
    });

    it('should work as error state', () => {
      const component = () => {
        const empty = Empty({ variant: 'error' });
        const icon = EmptyIcon({ children: '⚠️' });
        const title = EmptyTitle({ children: 'Failed to load data' });
        const description = EmptyDescription({
          children: 'An error occurred while loading the data',
        });
        const actions = EmptyActions({});
        const button = document.createElement('button');
        button.textContent = 'Retry';

        actions.appendChild(button);
        empty.appendChild(icon);
        empty.appendChild(title);
        empty.appendChild(description);
        empty.appendChild(actions);

        return empty;
      };

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]') as HTMLElement;
      expect(emptyEl.getAttribute('data-variant')).toBe('error');
      expect(container.querySelector('[data-empty-icon]')?.textContent).toBe('⚠️');
      expect(container.querySelector('[data-empty-title]')?.textContent).toBe('Failed to load data');
      expect(container.querySelector('button')?.textContent).toBe('Retry');
    });

    it('should work as custom empty state', () => {
      const component = () => {
        const empty = Empty({ variant: 'custom', class: 'custom-empty' });
        const customContent = document.createElement('div');
        customContent.innerHTML = '<p>Custom empty state content</p>';

        empty.appendChild(customContent);

        return empty;
      };

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('.custom-empty') as HTMLElement;
      expect(emptyEl.getAttribute('data-variant')).toBe('custom');
      expect(container.querySelector('p')?.textContent).toBe('Custom empty state content');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined children', () => {
      const component = () => Empty({ children: undefined });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]');
      expect(emptyEl).toBeTruthy();
      expect(emptyEl?.textContent).toBe('');
    });

    it('should handle null children', () => {
      const component = () => Empty({ children: null });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]');
      expect(emptyEl).toBeTruthy();
    });

    it('should handle empty array children', () => {
      const component = () => Empty({ children: [] });

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[data-empty]');
      expect(emptyEl).toBeTruthy();
    });

    it('should handle special characters in title', () => {
      const component = () => EmptyTitle({ children: '<script>alert("xss")</script>' });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('[data-empty-title]');
      expect(titleEl?.textContent).toBe('<script>alert("xss")</script>');
      expect(container.querySelector('script')).toBeNull();
    });

    it('should handle Unicode and emoji in description', () => {
      const component = () => EmptyDescription({ children: 'No items found ✓ 🔍' });

      const { container } = renderComponent(component);

      const descEl = container.querySelector('[data-empty-description]');
      expect(descEl?.textContent).toBe('No items found ✓ 🔍');
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with action button click handler', () => {
      let retryClicked = false;

      const component = () => {
        const empty = Empty({ variant: 'error' });
        const actions = EmptyActions({});
        const button = document.createElement('button');
        button.textContent = 'Retry';
        button.onclick = () => {
          retryClicked = true;
        };

        actions.appendChild(button);
        empty.appendChild(actions);

        return empty;
      };

      const { container } = renderComponent(component);

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      expect(retryClicked).toBe(true);
    });

    it('should work with multiple action buttons', () => {
      const component = () => {
        const empty = Empty({});
        const actions = EmptyActions({ class: 'button-group' });
        const btn1 = document.createElement('button');
        btn1.textContent = 'Primary Action';
        btn1.className = 'btn-primary';
        const btn2 = document.createElement('button');
        btn2.textContent = 'Secondary Action';
        btn2.className = 'btn-secondary';

        actions.appendChild(btn1);
        actions.appendChild(btn2);
        empty.appendChild(actions);

        return empty;
      };

      const { container } = renderComponent(component);

      const actions = container.querySelector('.button-group');
      const buttons = actions?.querySelectorAll('button');
      expect(buttons?.length).toBe(2);
      expect(buttons?.[0].textContent).toBe('Primary Action');
      expect(buttons?.[1].textContent).toBe('Secondary Action');
    });

    it('should maintain semantic structure for screen readers', () => {
      const component = () => {
        const empty = Empty({ variant: 'no-results' });
        const title = EmptyTitle({ children: 'No results' });
        const description = EmptyDescription({ children: 'Try different search terms' });

        empty.appendChild(title);
        empty.appendChild(description);

        return empty;
      };

      const { container } = renderComponent(component);

      const emptyEl = container.querySelector('[role="status"]') as HTMLElement;
      expect(emptyEl.getAttribute('aria-live')).toBe('polite');
      expect(container.querySelector('h3')).toBeTruthy();
      expect(container.querySelector('p')).toBeTruthy();
    });
  });
});
