/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Kbd } from '../../../src/primitives/Kbd.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Kbd', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render single key', () => {
      const component = () =>
        Kbd({
          children: 'Enter',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl).toBeTruthy();
      expect(kbdEl?.textContent).toBe('Enter');
      expect(kbdEl?.getAttribute('data-kbd')).toBe('');
    });

    it('should render text content', () => {
      const component = () =>
        Kbd({
          children: 'Escape',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('Escape');
    });

    it('should use semantic kbd element', () => {
      const component = () =>
        Kbd({
          children: 'Tab',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.tagName).toBe('KBD');
    });

    it('should have data-kbd attribute', () => {
      const component = () =>
        Kbd({
          children: 'Space',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.getAttribute('data-kbd')).toBe('');
    });
  });

  describe('Modifier keys', () => {
    it('should render Ctrl key', () => {
      const component = () =>
        Kbd({
          children: 'Ctrl',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('Ctrl');
    });

    it('should render Command/⌘ key', () => {
      const component = () =>
        Kbd({
          children: '⌘',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('⌘');
    });

    it('should render Shift key', () => {
      const component = () =>
        Kbd({
          children: 'Shift',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('Shift');
    });

    it('should render Alt/Option key', () => {
      const component = () =>
        Kbd({
          children: 'Alt',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('Alt');
    });

    it('should render Option symbol ⌥', () => {
      const component = () =>
        Kbd({
          children: '⌥',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('⌥');
    });

    it('should render Control symbol ⌃', () => {
      const component = () =>
        Kbd({
          children: '⌃',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('⌃');
    });

    it('should render Shift symbol ⇧', () => {
      const component = () =>
        Kbd({
          children: '⇧',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('⇧');
    });
  });

  describe('Special keys', () => {
    it('should render arrow keys', () => {
      const arrows = ['↑', '↓', '←', '→'];

      arrows.forEach((arrow) => {
        const component = () =>
          Kbd({
            children: arrow,
          });

        const { container, cleanup } = renderComponent(component);
        const kbdEl = container.querySelector('kbd');

        expect(kbdEl?.textContent).toBe(arrow);
        cleanup();
        document.body.innerHTML = '';
      });
    });

    it('should render Enter symbol ↵', () => {
      const component = () =>
        Kbd({
          children: '↵',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('↵');
    });

    it('should render Backspace symbol ⌫', () => {
      const component = () =>
        Kbd({
          children: '⌫',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('⌫');
    });

    it('should render Delete symbol ⌦', () => {
      const component = () =>
        Kbd({
          children: '⌦',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('⌦');
    });

    it('should render Escape symbol ⎋', () => {
      const component = () =>
        Kbd({
          children: '⎋',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('⎋');
    });

    it('should render Tab symbol ⇥', () => {
      const component = () =>
        Kbd({
          children: '⇥',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('⇥');
    });

    it('should render Caps Lock symbol ⇪', () => {
      const component = () =>
        Kbd({
          children: '⇪',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('⇪');
    });
  });

  describe('Nested key combinations', () => {
    it('should support nested kbd elements', () => {
      const component = () => {
        const parent = Kbd({
          children: [
            Kbd({ children: 'Ctrl' }),
            Kbd({ children: 'C' }),
          ],
        });
        return parent;
      };

      const { container } = renderComponent(component);

      const kbds = container.querySelectorAll('kbd');
      expect(kbds.length).toBe(3); // Parent + 2 children
    });

    it('should render command+key combination', () => {
      const component = () => {
        const parent = Kbd({
          class: 'combo',
          children: [
            Kbd({ children: '⌘' }),
            Kbd({ children: 'K' }),
          ],
        });
        return parent;
      };

      const { container } = renderComponent(component);

      const parentKbd = container.querySelector('kbd.combo');
      const childKbds = parentKbd?.querySelectorAll('kbd');

      expect(parentKbd).toBeTruthy();
      expect(childKbds?.length).toBe(2);
    });

    it('should render ctrl+shift+key combination', () => {
      const component = () => {
        const parent = Kbd({
          children: [
            Kbd({ children: 'Ctrl' }),
            Kbd({ children: 'Shift' }),
            Kbd({ children: 'P' }),
          ],
        });
        return parent;
      };

      const { container } = renderComponent(component);

      const kbds = container.querySelectorAll('kbd');
      expect(kbds.length).toBe(4); // Parent + 3 children
    });

    it('should maintain data-kbd on nested elements', () => {
      const component = () => {
        const parent = Kbd({
          children: [
            Kbd({ children: 'Ctrl' }),
            Kbd({ children: 'C' }),
          ],
        });
        return parent;
      };

      const { container } = renderComponent(component);

      const kbds = container.querySelectorAll('kbd');
      kbds.forEach((kbd) => {
        expect(kbd.getAttribute('data-kbd')).toBe('');
      });
    });
  });

  describe('Custom attributes', () => {
    it('should apply custom className', () => {
      const component = () =>
        Kbd({
          class: 'custom-key',
          children: 'Enter',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.className).toContain('custom-key');
    });

    it('should apply custom id', () => {
      const component = () =>
        Kbd({
          id: 'enter-key',
          children: 'Enter',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.id).toBe('enter-key');
    });

    it('should apply data attributes', () => {
      const component = () =>
        Kbd({
          'data-key': 'Enter',
          'data-type': 'special',
          children: 'Enter',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.getAttribute('data-key')).toBe('Enter');
      expect(kbdEl?.getAttribute('data-type')).toBe('special');
    });

    it('should apply style attribute', () => {
      const component = () =>
        Kbd({
          style: { backgroundColor: 'blue' },
          children: 'K',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd') as HTMLElement;
      expect(kbdEl?.style.backgroundColor).toBe('blue');
    });

    it('should apply title attribute', () => {
      const component = () =>
        Kbd({
          title: 'Press Enter to submit',
          children: 'Enter',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.getAttribute('title')).toBe('Press Enter to submit');
    });

    it('should support multiple custom classes', () => {
      const component = () =>
        Kbd({
          class: 'key modifier primary',
          children: 'Ctrl',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.className).toContain('key');
      expect(kbdEl?.className).toContain('modifier');
      expect(kbdEl?.className).toContain('primary');
    });
  });

  describe('Children handling', () => {
    it('should render string children', () => {
      const component = () =>
        Kbd({
          children: 'A',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('A');
    });

    it('should render single character', () => {
      const component = () =>
        Kbd({
          children: 'Z',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('Z');
    });

    it('should render numeric keys', () => {
      for (let i = 0; i <= 9; i++) {
        const component = () =>
          Kbd({
            children: String(i),
          });

        const { container, cleanup } = renderComponent(component);
        const kbdEl = container.querySelector('kbd');

        expect(kbdEl?.textContent).toBe(String(i));
        cleanup();
        document.body.innerHTML = '';
      }
    });

    it('should render function keys', () => {
      const component = () =>
        Kbd({
          children: 'F1',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('F1');
    });

    it('should render empty string', () => {
      const component = () =>
        Kbd({
          children: '',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('');
    });

    it('should render punctuation keys', () => {
      const punctuation = [',', '.', '/', ';', "'", '[', ']', '\\', '`', '-', '='];

      punctuation.forEach((char) => {
        const component = () =>
          Kbd({
            children: char,
          });

        const { container, cleanup } = renderComponent(component);
        const kbdEl = container.querySelector('kbd');

        expect(kbdEl?.textContent).toBe(char);
        cleanup();
        document.body.innerHTML = '';
      });
    });
  });

  describe('Accessibility', () => {
    it('should be readable by screen readers', () => {
      const component = () =>
        Kbd({
          children: 'Enter',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.getAttribute('aria-hidden')).toBeNull();
      expect(kbdEl?.textContent).toBe('Enter');
    });

    it('should support aria-label', () => {
      const component = () =>
        Kbd({
          'aria-label': 'Command key',
          children: '⌘',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.getAttribute('aria-label')).toBe('Command key');
    });

    it('should support aria-describedby', () => {
      const component = () =>
        Kbd({
          'aria-describedby': 'key-description',
          children: 'F1',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.getAttribute('aria-describedby')).toBe('key-description');
    });

    it('should announce keyboard key to screen readers', () => {
      // Screen readers should announce content as "keyboard key"
      const component = () =>
        Kbd({
          children: 'Ctrl',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.tagName).toBe('KBD');
    });

    it('should support role attribute if needed', () => {
      const component = () =>
        Kbd({
          role: 'button',
          children: 'Enter',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.getAttribute('role')).toBe('button');
    });
  });

  describe('Platform-specific keys', () => {
    it('should render Windows key', () => {
      const component = () =>
        Kbd({
          children: '⊞',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('⊞');
    });

    it('should render macOS Command key', () => {
      const component = () =>
        Kbd({
          children: '⌘',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('⌘');
    });

    it('should render macOS Option key', () => {
      const component = () =>
        Kbd({
          children: '⌥',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('⌥');
    });

    it('should render Linux Super key', () => {
      const component = () =>
        Kbd({
          children: 'Super',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('Super');
    });
  });

  describe('Integration scenarios', () => {
    it('should work in documentation context', () => {
      const component = () => {
        const p = document.createElement('p');
        p.textContent = 'Press ';
        p.appendChild(Kbd({ children: 'Ctrl' }));
        p.appendChild(document.createTextNode(' + '));
        p.appendChild(Kbd({ children: 'C' }));
        p.appendChild(document.createTextNode(' to copy'));
        return p;
      };

      const { container } = renderComponent(component);

      const kbds = container.querySelectorAll('kbd');
      expect(kbds.length).toBe(2);
      expect(kbds[0]?.textContent).toBe('Ctrl');
      expect(kbds[1]?.textContent).toBe('C');
    });

    it('should work in keyboard shortcuts table', () => {
      const component = () => {
        const div = document.createElement('div');
        div.appendChild(Kbd({ children: '⌘' }));
        div.appendChild(Kbd({ children: 'K' }));
        return div;
      };

      const { container } = renderComponent(component);

      const kbds = container.querySelectorAll('kbd');
      expect(kbds.length).toBe(2);
    });

    it('should work in help text', () => {
      const component = () => {
        const p = document.createElement('p');
        p.textContent = 'Press ';
        p.appendChild(Kbd({ children: 'Enter' }));
        p.appendChild(document.createTextNode(' to submit'));
        return p;
      };

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('Enter');
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined children', () => {
      const component = () =>
        Kbd({
          children: undefined,
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl).toBeTruthy();
    });

    it('should handle null children', () => {
      const component = () =>
        Kbd({
          children: null,
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl).toBeTruthy();
    });

    it('should handle spaces', () => {
      const component = () =>
        Kbd({
          children: 'Space',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('Space');
    });

    it('should handle very long text', () => {
      const component = () =>
        Kbd({
          children: 'Very Long Key Name That Should Not Exist',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('Very Long Key Name That Should Not Exist');
    });

    it('should handle international characters', () => {
      const component = () =>
        Kbd({
          children: 'ñ',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('ñ');
    });

    it('should handle emoji characters', () => {
      const component = () =>
        Kbd({
          children: '⌘',
        });

      const { container } = renderComponent(component);

      const kbdEl = container.querySelector('kbd');
      expect(kbdEl?.textContent).toBe('⌘');
    });
  });

  describe('Display name', () => {
    it('should have correct display name', () => {
      expect(Kbd.displayName).toBe('Kbd');
    });
  });

  describe('Multiple key patterns', () => {
    it('should render Ctrl+Alt+Delete pattern', () => {
      const component = () => {
        const parent = Kbd({
          class: 'combo',
          children: [
            Kbd({ children: 'Ctrl' }),
            Kbd({ children: 'Alt' }),
            Kbd({ children: 'Delete' }),
          ],
        });
        return parent;
      };

      const { container } = renderComponent(component);

      const parentKbd = container.querySelector('kbd.combo');
      const childKbds = parentKbd?.querySelectorAll('kbd');

      expect(parentKbd).toBeTruthy();
      expect(childKbds?.length).toBe(3);
    });

    it('should render Alt+F4 pattern', () => {
      const component = () => {
        const parent = Kbd({
          children: [
            Kbd({ children: 'Alt' }),
            Kbd({ children: 'F4' }),
          ],
        });
        return parent;
      };

      const { container } = renderComponent(component);

      const kbds = container.querySelectorAll('kbd');
      expect(kbds.length).toBe(3); // Parent + 2 children
    });

    it('should handle complex key combinations', () => {
      const component = () => {
        const parent = Kbd({
          children: [
            Kbd({ children: 'Ctrl' }),
            Kbd({ children: 'Shift' }),
            Kbd({ children: 'Alt' }),
            Kbd({ children: 'F12' }),
          ],
        });
        return parent;
      };

      const { container } = renderComponent(component);

      const kbds = container.querySelectorAll('kbd');
      expect(kbds.length).toBe(5); // Parent + 4 children
    });
  });
});
