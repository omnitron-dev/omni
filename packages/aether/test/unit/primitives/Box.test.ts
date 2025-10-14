/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Box } from '../../../src/primitives/Box.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Box', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic Rendering', () => {
    it('should render as a div by default', () => {
      const component = () => Box({ children: 'Hello Box' });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div');
      expect(boxEl).toBeTruthy();
      expect(boxEl?.textContent).toBe('Hello Box');
    });

    it('should render with no children', () => {
      const component = () => Box({});

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div');
      expect(boxEl).toBeTruthy();
      expect(boxEl?.textContent).toBe('');
    });

    it('should render with multiple children', () => {
      const component = () =>
        Box({
          children: [
            Box({ children: 'Child 1', class: 'child-1' }),
            Box({ children: 'Child 2', class: 'child-2' }),
            Box({ children: 'Child 3', class: 'child-3' }),
          ],
        });

      const { container } = renderComponent(component);

      const children = container.querySelectorAll('.child-1, .child-2, .child-3');
      expect(children.length).toBe(3);
      expect(children[0].textContent).toBe('Child 1');
      expect(children[1].textContent).toBe('Child 2');
      expect(children[2].textContent).toBe('Child 3');
    });

    it('should render with number children', () => {
      const component = () => Box({ children: 42 });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div');
      expect(boxEl?.textContent).toBe('42');
    });

    it('should render with string and number children in array', () => {
      const component = () => Box({ children: ['Text', 42, 'More'] });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div');
      expect(boxEl?.textContent).toContain('Text');
      expect(boxEl?.textContent).toContain('42');
      expect(boxEl?.textContent).toContain('More');
    });
  });

  describe('Polymorphic Behavior (as prop)', () => {
    it('should render as section when as="section"', () => {
      const component = () =>
        Box({
          as: 'section',
          children: 'Section content',
        });

      const { container } = renderComponent(component);

      const sectionEl = container.querySelector('section');
      expect(sectionEl).toBeTruthy();
      expect(sectionEl?.textContent).toBe('Section content');
    });

    it('should render as article when as="article"', () => {
      const component = () =>
        Box({
          as: 'article',
          children: 'Article content',
        });

      const { container } = renderComponent(component);

      const articleEl = container.querySelector('article');
      expect(articleEl).toBeTruthy();
      expect(articleEl?.textContent).toBe('Article content');
    });

    it('should render as header when as="header"', () => {
      const component = () =>
        Box({
          as: 'header',
          children: 'Header content',
        });

      const { container } = renderComponent(component);

      const headerEl = container.querySelector('header');
      expect(headerEl).toBeTruthy();
      expect(headerEl?.textContent).toBe('Header content');
    });

    it('should render as footer when as="footer"', () => {
      const component = () =>
        Box({
          as: 'footer',
          children: 'Footer content',
        });

      const { container } = renderComponent(component);

      const footerEl = container.querySelector('footer');
      expect(footerEl).toBeTruthy();
      expect(footerEl?.textContent).toBe('Footer content');
    });

    it('should render as nav when as="nav"', () => {
      const component = () =>
        Box({
          as: 'nav',
          children: 'Nav content',
        });

      const { container } = renderComponent(component);

      const navEl = container.querySelector('nav');
      expect(navEl).toBeTruthy();
      expect(navEl?.textContent).toBe('Nav content');
    });

    it('should render as aside when as="aside"', () => {
      const component = () =>
        Box({
          as: 'aside',
          children: 'Aside content',
        });

      const { container } = renderComponent(component);

      const asideEl = container.querySelector('aside');
      expect(asideEl).toBeTruthy();
      expect(asideEl?.textContent).toBe('Aside content');
    });

    it('should render as main when as="main"', () => {
      const component = () =>
        Box({
          as: 'main',
          children: 'Main content',
        });

      const { container } = renderComponent(component);

      const mainEl = container.querySelector('main');
      expect(mainEl).toBeTruthy();
      expect(mainEl?.textContent).toBe('Main content');
    });

    it('should render as button when as="button"', () => {
      const component = () =>
        Box({
          as: 'button',
          type: 'button',
          children: 'Click me',
        });

      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button');
      expect(buttonEl).toBeTruthy();
      expect(buttonEl?.textContent).toBe('Click me');
      expect(buttonEl?.getAttribute('type')).toBe('button');
    });

    it('should render as span when as="span"', () => {
      const component = () =>
        Box({
          as: 'span',
          children: 'Span content',
        });

      const { container } = renderComponent(component);

      const spanEl = container.querySelector('span');
      expect(spanEl).toBeTruthy();
      expect(spanEl?.textContent).toBe('Span content');
    });

    it('should render as p when as="p"', () => {
      const component = () =>
        Box({
          as: 'p',
          children: 'Paragraph content',
        });

      const { container } = renderComponent(component);

      const pEl = container.querySelector('p');
      expect(pEl).toBeTruthy();
      expect(pEl?.textContent).toBe('Paragraph content');
    });
  });

  describe('Styling', () => {
    it('should apply class name', () => {
      const component = () =>
        Box({
          class: 'custom-box',
          children: 'Styled box',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('.custom-box');
      expect(boxEl).toBeTruthy();
      expect(boxEl?.textContent).toBe('Styled box');
    });

    it('should apply multiple class names', () => {
      const component = () =>
        Box({
          class: 'box card shadow',
          children: 'Multi-class box',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div') as HTMLElement;
      expect(boxEl.classList.contains('box')).toBe(true);
      expect(boxEl.classList.contains('card')).toBe(true);
      expect(boxEl.classList.contains('shadow')).toBe(true);
    });

    it('should apply inline styles', () => {
      const component = () =>
        Box({
          style: {
            padding: '16px',
            background: '#f0f0f0',
            borderRadius: '8px',
          },
          children: 'Styled box',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div') as HTMLElement;
      expect(boxEl.style.padding).toBe('16px');
      expect(boxEl.style.background).toBe('#f0f0f0');
      expect(boxEl.style.borderRadius).toBe('8px');
    });

    it('should apply both class and style', () => {
      const component = () =>
        Box({
          class: 'card',
          style: { padding: '24px' },
          children: 'Card box',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('.card') as HTMLElement;
      expect(boxEl).toBeTruthy();
      expect(boxEl.style.padding).toBe('24px');
    });

    it('should apply conditional class names', () => {
      const isActive = false;
      const component = () =>
        Box({
          class: isActive ? 'box active' : 'box',
          children: 'Toggle box',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div') as HTMLElement;
      expect(boxEl.classList.contains('active')).toBe(false);
      expect(boxEl.classList.contains('box')).toBe(true);
    });

    it('should apply styles from object', () => {
      const component = () =>
        Box({
          style: { color: 'red', fontSize: '16px' },
          children: 'Colored text',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div') as HTMLElement;
      expect(boxEl.style.color).toBe('red');
      expect(boxEl.style.fontSize).toBe('16px');
    });
  });

  describe('Props Forwarding', () => {
    it('should forward data attributes', () => {
      const component = () =>
        Box({
          'data-testid': 'test-box',
          'data-category': 'layout',
          children: 'Box with data attrs',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div') as HTMLElement;
      expect(boxEl.getAttribute('data-testid')).toBe('test-box');
      expect(boxEl.getAttribute('data-category')).toBe('layout');
    });

    it('should forward aria attributes', () => {
      const component = () =>
        Box({
          as: 'button',
          role: 'button',
          'aria-label': 'Close dialog',
          'aria-pressed': 'false',
          children: 'X',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('button') as HTMLElement;
      expect(boxEl.getAttribute('role')).toBe('button');
      expect(boxEl.getAttribute('aria-label')).toBe('Close dialog');
      expect(boxEl.getAttribute('aria-pressed')).toBe('false');
    });

    it('should forward id attribute', () => {
      const component = () =>
        Box({
          id: 'main-container',
          children: 'Container',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('#main-container');
      expect(boxEl).toBeTruthy();
    });

    it('should forward title attribute', () => {
      const component = () =>
        Box({
          title: 'This is a tooltip',
          children: 'Hover me',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div') as HTMLElement;
      expect(boxEl.getAttribute('title')).toBe('This is a tooltip');
    });

    it('should forward event handlers', () => {
      let clicked = false;
      const handleClick = () => {
        clicked = true;
      };

      const component = () =>
        Box({
          onClick: handleClick,
          children: 'Clickable box',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div') as HTMLElement;
      boxEl.click();

      expect(clicked).toBe(true);
    });

    it('should forward multiple event handlers', () => {
      let mouseEntered = false;
      let mouseLeft = false;

      const component = () =>
        Box({
          onMouseEnter: () => {
            mouseEntered = true;
          },
          onMouseLeave: () => {
            mouseLeft = true;
          },
          children: 'Interactive box',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div') as HTMLElement;

      boxEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      expect(mouseEntered).toBe(true);

      boxEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      expect(mouseLeft).toBe(true);
    });

    it('should forward form-related attributes when rendered as form element', () => {
      const component = () =>
        Box({
          as: 'button',
          type: 'submit',
          name: 'submit-btn',
          value: 'submit',
          disabled: true,
          children: 'Submit',
        });

      const { container } = renderComponent(component);

      const buttonEl = container.querySelector('button') as HTMLButtonElement;
      expect(buttonEl.getAttribute('type')).toBe('submit');
      expect(buttonEl.getAttribute('name')).toBe('submit-btn');
      expect(buttonEl.getAttribute('value')).toBe('submit');
      expect(buttonEl.disabled).toBe(true);
    });
  });

  describe('Accessibility', () => {
    it('should support semantic HTML elements', () => {
      const component = () =>
        Box({
          as: 'article',
          role: 'article',
          'aria-label': 'Main article',
          children: 'Article content',
        });

      const { container } = renderComponent(component);

      const articleEl = container.querySelector('article') as HTMLElement;
      expect(articleEl).toBeTruthy();
      expect(articleEl.getAttribute('role')).toBe('article');
      expect(articleEl.getAttribute('aria-label')).toBe('Main article');
    });

    it('should support role attribute', () => {
      const component = () =>
        Box({
          role: 'banner',
          children: 'Banner content',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('[role="banner"]');
      expect(boxEl).toBeTruthy();
    });

    it('should support aria-labelledby', () => {
      const component = () =>
        Box({
          as: 'section',
          'aria-labelledby': 'section-title',
          children: [
            Box({ id: 'section-title', as: 'h2', children: 'Section Title' }),
            Box({ children: 'Section content' }),
          ],
        });

      const { container } = renderComponent(component);

      const sectionEl = container.querySelector('section') as HTMLElement;
      expect(sectionEl.getAttribute('aria-labelledby')).toBe('section-title');

      const titleEl = container.querySelector('#section-title');
      expect(titleEl?.textContent).toBe('Section Title');
    });

    it('should support aria-describedby', () => {
      const component = () =>
        Box({
          'aria-describedby': 'help-text',
          children: [Box({ children: 'Input field' }), Box({ id: 'help-text', children: 'Enter your name' })],
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div') as HTMLElement;
      expect(boxEl.getAttribute('aria-describedby')).toBe('help-text');
    });

    it('should support tabindex for keyboard navigation', () => {
      const component = () =>
        Box({
          tabindex: '0',
          children: 'Focusable box',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div') as HTMLElement;
      expect(boxEl.getAttribute('tabindex')).toBe('0');
    });

    it('should support aria-hidden', () => {
      const component = () =>
        Box({
          'aria-hidden': 'true',
          children: 'Hidden from screen readers',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div') as HTMLElement;
      expect(boxEl.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('Nested Composition', () => {
    it('should support deeply nested boxes', () => {
      const component = () =>
        Box({
          class: 'level-1',
          children: Box({
            class: 'level-2',
            children: Box({
              class: 'level-3',
              children: 'Deeply nested',
            }),
          }),
        });

      const { container } = renderComponent(component);

      const level1 = container.querySelector('.level-1');
      const level2 = level1?.querySelector('.level-2');
      const level3 = level2?.querySelector('.level-3');

      expect(level1).toBeTruthy();
      expect(level2).toBeTruthy();
      expect(level3).toBeTruthy();
      expect(level3?.textContent).toBe('Deeply nested');
    });

    it('should support mixed element types in composition', () => {
      const component = () =>
        Box({
          as: 'section',
          class: 'page-section',
          children: [
            Box({ as: 'header', children: 'Header' }),
            Box({ as: 'article', children: 'Article' }),
            Box({ as: 'footer', children: 'Footer' }),
          ],
        });

      const { container } = renderComponent(component);

      const section = container.querySelector('section');
      const header = section?.querySelector('header');
      const article = section?.querySelector('article');
      const footer = section?.querySelector('footer');

      expect(section).toBeTruthy();
      expect(header?.textContent).toBe('Header');
      expect(article?.textContent).toBe('Article');
      expect(footer?.textContent).toBe('Footer');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined children', () => {
      const component = () =>
        Box({
          children: undefined,
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div');
      expect(boxEl).toBeTruthy();
      expect(boxEl?.textContent).toBe('');
    });

    it('should handle null children', () => {
      const component = () =>
        Box({
          children: null,
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div');
      expect(boxEl).toBeTruthy();
      expect(boxEl?.textContent).toBe('');
    });

    it('should handle empty string children', () => {
      const component = () =>
        Box({
          children: '',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div');
      expect(boxEl).toBeTruthy();
      expect(boxEl?.textContent).toBe('');
    });

    it('should handle zero as children', () => {
      const component = () =>
        Box({
          children: 0,
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div');
      expect(boxEl?.textContent).toBe('0');
    });

    it('should handle boolean children', () => {
      const component = () =>
        Box({
          children: [true, false, 'text'],
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div');
      expect(boxEl?.textContent).toContain('text');
    });

    it('should handle empty array children', () => {
      const component = () =>
        Box({
          children: [],
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div');
      expect(boxEl).toBeTruthy();
    });

    it('should not include as prop in rendered element', () => {
      const component = () =>
        Box({
          as: 'section',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const sectionEl = container.querySelector('section') as HTMLElement;
      expect(sectionEl.hasAttribute('as')).toBe(false);
    });

    it('should handle special characters in content', () => {
      const component = () =>
        Box({
          children: '<script>alert("xss")</script>',
        });

      const { container } = renderComponent(component);

      const boxEl = container.querySelector('div');
      expect(boxEl?.textContent).toBe('<script>alert("xss")</script>');
      expect(container.querySelector('script')).toBeNull();
    });
  });

  describe('Performance', () => {
    it('should handle large number of children efficiently', () => {
      const children = Array.from({ length: 100 }, (_, i) =>
        Box({
          class: `item-${i}`,
          children: `Item ${i}`,
        })
      );

      const component = () =>
        Box({
          class: 'list',
          children,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('.list');
      const items = list?.querySelectorAll('[class^="item-"]');
      expect(items?.length).toBe(100);
    });

    it('should render many boxes efficiently', () => {
      const children = Array.from({ length: 50 }, (_, i) =>
        Box({
          key: `box-${i}`,
          children: `Box ${i}`,
        })
      );

      const component = () =>
        Box({
          class: 'container',
          children,
        });

      const { container } = renderComponent(component);

      const containerEl = container.querySelector('.container');
      const boxes = containerEl?.querySelectorAll('div');
      expect(boxes?.length).toBeGreaterThan(0);
    });
  });
});
