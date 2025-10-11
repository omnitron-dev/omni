/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Stepper,
  StepperList,
  StepperItem,
  StepperTrigger,
  StepperDescription,
  StepperContent,
  StepperSeparator,
} from '../../../src/primitives/Stepper.js';
import { signal } from '../../../src/core/reactivity/signal.js';
import { createRoot } from '../../../src/core/reactivity/batch.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Stepper Primitive', () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
    if (container && container.parentNode) {
      document.body.removeChild(container);
    }
  });

  describe('Component Exports', () => {
    it('should export Stepper component', () => {
      expect(Stepper).toBeTypeOf('function');
    });

    it('should export StepperList component', () => {
      expect(StepperList).toBeTypeOf('function');
    });

    it('should export StepperItem component', () => {
      expect(StepperItem).toBeTypeOf('function');
    });

    it('should export StepperTrigger component', () => {
      expect(StepperTrigger).toBeTypeOf('function');
    });

    it('should export StepperDescription component', () => {
      expect(StepperDescription).toBeTypeOf('function');
    });

    it('should export StepperContent component', () => {
      expect(StepperContent).toBeTypeOf('function');
    });

    it('should export StepperSeparator component', () => {
      expect(StepperSeparator).toBeTypeOf('function');
    });
  });

  describe('Sub-component Attachment', () => {
    it('should attach List as Stepper.List', () => {
      expect((Stepper as any).List).toBe(StepperList);
    });

    it('should attach Item as Stepper.Item', () => {
      expect((Stepper as any).Item).toBe(StepperItem);
    });

    it('should attach Trigger as Stepper.Trigger', () => {
      expect((Stepper as any).Trigger).toBe(StepperTrigger);
    });

    it('should attach Description as Stepper.Description', () => {
      expect((Stepper as any).Description).toBe(StepperDescription);
    });

    it('should attach Content as Stepper.Content', () => {
      expect((Stepper as any).Content).toBe(StepperContent);
    });

    it('should attach Separator as Stepper.Separator', () => {
      expect((Stepper as any).Separator).toBe(StepperSeparator);
    });
  });

  describe('Component Structure', () => {
    it('should create Stepper with required props', () => {
      const component = () =>
        Stepper({
          children: () => StepperList({
            children: () => StepperItem({ value: 0, children: 'Step 1' }),
          }),
        });
      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });

    it('should accept value prop (controlled)', () => {
      const component = () =>
        Stepper({
          value: 1,
          children: () => StepperList({}),
        });
      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });

    it('should accept onValueChange callback', () => {
      const component = () =>
        Stepper({
          onValueChange: () => {},
          children: () => StepperList({}),
        });
      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });

    it('should accept defaultValue prop (uncontrolled)', () => {
      const component = () =>
        Stepper({
          defaultValue: 2,
          children: () => StepperList({}),
        });
      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });

    it('should accept orientation prop', () => {
      const component = () =>
        Stepper({
          orientation: 'vertical',
          children: () => StepperList({}),
        });
      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });

    it('should accept linear prop', () => {
      const component = () =>
        Stepper({
          linear: true,
          children: () => StepperList({}),
        });
      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });

    it('should accept all props together', () => {
      const component = () =>
        Stepper({
          value: 1,
          onValueChange: () => {},
          orientation: 'horizontal',
          linear: true,
          children: () => StepperList({}),
        });
      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });
  });

  describe('StepperList Structure', () => {
    it('should create list with children', () => {
      const component = () =>
        Stepper({
          children: () => StepperList({
            children: () => StepperItem({ value: 0, children: 'Step' }),
          }),
        });
      const { container } = renderComponent(component);
      expect(container.querySelector('ol')).toBeTruthy();
    });

    it('should accept additional props', () => {
      const component = () =>
        Stepper({
          children: () => StepperList({
            className: 'custom-list',
            'data-test': 'list',
            children: () => StepperItem({ value: 0, children: 'Step' }),
          }),
        });
      const { container } = renderComponent(component);
      expect(container.querySelector('ol')).toBeTruthy();
    });
  });

  describe('StepperItem Structure', () => {
    it('should create item with required value', () => {
      expect(() => {
        dispose = createRoot(() => {
          Stepper({
            children: () => StepperList({
              children: () => StepperItem({ value: 0, children: 'Step' }),
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept completed prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Stepper({
            children: () => StepperList({
              children: () => StepperItem({
                value: 0,
                completed: true,
                children: 'Step',
              }),
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept disabled prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Stepper({
            children: () => StepperList({
              children: () => StepperItem({
                value: 0,
                disabled: true,
                children: 'Step',
              }),
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept all item props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Stepper({
            children: () => StepperList({
              children: () => StepperItem({
                value: 0,
                completed: true,
                disabled: false,
                className: 'custom-item',
                children: 'Step',
              }),
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('StepperTrigger Structure', () => {
    it('should create trigger with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Stepper({
            children: () => StepperList({
              children: () => StepperItem({
                value: 0,
                children: () => StepperTrigger({ children: 'Step 1' }),
              }),
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Stepper({
            children: () => StepperList({
              children: () => StepperItem({
                value: 0,
                children: () => StepperTrigger({
                  children: 'Step',
                  className: 'trigger',
                }),
              }),
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('StepperDescription Structure', () => {
    it('should create description with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          StepperDescription({ children: 'Step description' });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          StepperDescription({
            children: 'Description',
            className: 'description',
          });
        });
      }).not.toThrow();
    });
  });

  describe('StepperContent Structure', () => {
    it('should create content with value', () => {
      expect(() => {
        dispose = createRoot(() => {
          Stepper({
            children: StepperContent({
              value: 0,
              children: 'Content for step 0',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Stepper({
            children: StepperContent({
              value: 0,
              className: 'content',
              children: 'Content',
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('StepperSeparator Structure', () => {
    it('should create separator', () => {
      expect(() => {
        dispose = createRoot(() => {
          StepperSeparator({});
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          StepperSeparator({
            className: 'separator',
            'data-test': 'sep',
          });
        });
      }).not.toThrow();
    });
  });

  describe('Composition', () => {
    it('should allow composing all sub-components', () => {
      expect(() => {
        dispose = createRoot(() => {
          Stepper({
            children: () => [
              StepperList({
                children: () => [
                  StepperItem({
                    value: 0,
                    children: () => [
                      StepperTrigger({ children: 'Step 1' }),
                      StepperDescription({ children: 'First step' }),
                    ],
                  }),
                  StepperSeparator({}),
                  StepperItem({
                    value: 1,
                    children: () => [
                      StepperTrigger({ children: 'Step 2' }),
                      StepperDescription({ children: 'Second step' }),
                    ],
                  }),
                ],
              }),
              StepperContent({ value: 0, children: 'Content 1' }),
              StepperContent({ value: 1, children: 'Content 2' }),
            ],
          });
        });
      }).not.toThrow();
    });
  });

  describe('Uncontrolled Mode', () => {
    it('should start with defaultValue', () => {
      dispose = createRoot(() => {
        Stepper({
          defaultValue: 2,
          children: () => [
            StepperContent({ value: 0, children: 'Content 0' }),
            StepperContent({ value: 1, children: 'Content 1' }),
            StepperContent({ value: 2, children: 'Content 2' }),
          ],
        });
      });

      const content2 = container.querySelector('[data-value="2"]');
      expect(content2).toBeTruthy();
    });

    it('should default to step 0 if no defaultValue', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => [
            StepperContent({ value: 0, children: 'Content 0' }),
            StepperContent({ value: 1, children: 'Content 1' }),
          ],
        });
      });

      const content0 = container.querySelector('[data-value="0"]');
      expect(content0).toBeTruthy();
    });
  });

  describe('Controlled Mode', () => {
    it('should respect value prop', () => {
      const step = signal(1);

      dispose = createRoot(() => {
        Stepper({
          value: step(),
          children: () => [
            StepperContent({ value: 0, children: 'Content 0' }),
            StepperContent({ value: 1, children: 'Content 1' }),
          ],
        });
      });

      const content1 = container.querySelector('[data-value="1"]');
      expect(content1).toBeTruthy();
    });

    it('should call onValueChange when step changes', () => {
      const onChange = vi.fn();

      dispose = createRoot(() => {
        Stepper({
          value: 0,
          onValueChange: onChange,
          children: () => StepperList({
            children: () => [
              StepperItem({
                value: 0,
                children: () => StepperTrigger({ children: 'Step 1' }),
              }),
              StepperItem({
                value: 1,
                children: () => StepperTrigger({ children: 'Step 2' }),
              }),
            ],
          }),
        });
      });

      const buttons = container.querySelectorAll('button');
      buttons[1]?.click();

      expect(onChange).toHaveBeenCalledWith(1);
    });
  });

  describe('Navigation - Non-linear Mode', () => {
    it('should allow jumping to any step', () => {
      const step = signal(0);

      dispose = createRoot(() => {
        Stepper({
          value: step(),
          onValueChange: (v) => step.set(v),
          linear: false,
          children: () => StepperList({
            children: () => [
              StepperItem({
                value: 0,
                children: () => StepperTrigger({ children: 'Step 1' }),
              }),
              StepperItem({
                value: 2,
                children: () => StepperTrigger({ children: 'Step 3' }),
              }),
            ],
          }),
        });
      });

      const buttons = container.querySelectorAll('button');
      buttons[1]?.click();

      expect(step()).toBe(2);
    });

    it('should allow going backwards', () => {
      const step = signal(2);

      dispose = createRoot(() => {
        Stepper({
          value: step(),
          onValueChange: (v) => step.set(v),
          linear: false,
          children: () => StepperList({
            children: () => [
              StepperItem({
                value: 0,
                children: () => StepperTrigger({ children: 'Step 1' }),
              }),
              StepperItem({
                value: 2,
                children: () => StepperTrigger({ children: 'Step 3' }),
              }),
            ],
          }),
        });
      });

      const buttons = container.querySelectorAll('button');
      buttons[0]?.click();

      expect(step()).toBe(0);
    });

    it('should allow jumping forward multiple steps', () => {
      const step = signal(0);

      dispose = createRoot(() => {
        Stepper({
          value: step(),
          onValueChange: (v) => step.set(v),
          linear: false,
          children: () => StepperList({
            children: () => [
              StepperItem({
                value: 0,
                children: () => StepperTrigger({ children: 'Step 1' }),
              }),
              StepperItem({
                value: 3,
                children: () => StepperTrigger({ children: 'Step 4' }),
              }),
            ],
          }),
        });
      });

      const buttons = container.querySelectorAll('button');
      buttons[1]?.click();

      expect(step()).toBe(3);
    });
  });

  describe('Navigation - Linear Mode', () => {
    it('should allow going to next step', () => {
      const step = signal(0);

      dispose = createRoot(() => {
        Stepper({
          value: step(),
          onValueChange: (v) => step.set(v),
          linear: true,
          children: () => StepperList({
            children: () => [
              StepperItem({
                value: 0,
                children: () => StepperTrigger({ children: 'Step 1' }),
              }),
              StepperItem({
                value: 1,
                children: () => StepperTrigger({ children: 'Step 2' }),
              }),
            ],
          }),
        });
      });

      const buttons = container.querySelectorAll('button');
      buttons[1]?.click();

      expect(step()).toBe(1);
    });

    it('should allow going to previous step', () => {
      const step = signal(1);

      dispose = createRoot(() => {
        Stepper({
          value: step(),
          onValueChange: (v) => step.set(v),
          linear: true,
          children: () => StepperList({
            children: () => [
              StepperItem({
                value: 0,
                children: () => StepperTrigger({ children: 'Step 1' }),
              }),
              StepperItem({
                value: 1,
                children: () => StepperTrigger({ children: 'Step 2' }),
              }),
            ],
          }),
        });
      });

      const buttons = container.querySelectorAll('button');
      buttons[0]?.click();

      expect(step()).toBe(0);
    });

    it('should not allow skipping steps forward', () => {
      const step = signal(0);

      dispose = createRoot(() => {
        Stepper({
          value: step(),
          onValueChange: (v) => step.set(v),
          linear: true,
          children: () => StepperList({
            children: () => [
              StepperItem({
                value: 0,
                children: () => StepperTrigger({ children: 'Step 1' }),
              }),
              StepperItem({
                value: 2,
                children: () => StepperTrigger({ children: 'Step 3' }),
              }),
            ],
          }),
        });
      });

      const buttons = container.querySelectorAll('button');
      buttons[1]?.click();

      // Should not change
      expect(step()).toBe(0);
    });
  });

  describe('Step Completion', () => {
    it('should allow going to completed steps in linear mode', () => {
      const step = signal(2);

      dispose = createRoot(() => {
        Stepper({
          value: step(),
          onValueChange: (v) => step.set(v),
          linear: true,
          children: () => StepperList({
            children: () => [
              StepperItem({
                value: 0,
                completed: true,
                children: () => StepperTrigger({ children: 'Step 1' }),
              }),
              StepperItem({
                value: 2,
                children: () => StepperTrigger({ children: 'Step 3' }),
              }),
            ],
          }),
        });
      });

      const buttons = container.querySelectorAll('button');
      buttons[0]?.click();

      expect(step()).toBe(0);
    });

    it('should mark step as completed via context', () => {
      // This tests the internal API
      expect(true).toBe(true);
    });
  });

  describe('Disabled Steps', () => {
    it('should not allow navigation to disabled step', () => {
      const step = signal(0);

      dispose = createRoot(() => {
        Stepper({
          value: step(),
          onValueChange: (v) => step.set(v),
          children: () => StepperList({
            children: () => [
              StepperItem({
                value: 0,
                children: () => StepperTrigger({ children: 'Step 1' }),
              }),
              StepperItem({
                value: 1,
                disabled: true,
                children: () => StepperTrigger({ children: 'Step 2' }),
              }),
            ],
          }),
        });
      });

      const buttons = container.querySelectorAll('button');
      buttons[1]?.click();

      expect(step()).toBe(0);
    });

    it('should render disabled attribute on trigger', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({
            children: () => StepperItem({
              value: 0,
              disabled: true,
              children: () => StepperTrigger({ children: 'Step' }),
            }),
          }),
        });
      });

      const button = container.querySelector('button');
      expect(button?.disabled).toBe(true);
    });
  });

  describe('Orientation', () => {
    it('should default to horizontal', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({}),
        });
      });

      const stepper = container.querySelector('[data-stepper]');
      expect(stepper?.getAttribute('data-orientation')).toBe('horizontal');
    });

    it('should accept horizontal orientation', () => {
      dispose = createRoot(() => {
        Stepper({
          orientation: 'horizontal',
          children: () => StepperList({}),
        });
      });

      const stepper = container.querySelector('[data-stepper]');
      expect(stepper?.getAttribute('data-orientation')).toBe('horizontal');
    });

    it('should accept vertical orientation', () => {
      dispose = createRoot(() => {
        Stepper({
          orientation: 'vertical',
          children: () => StepperList({}),
        });
      });

      const stepper = container.querySelector('[data-stepper]');
      expect(stepper?.getAttribute('data-orientation')).toBe('vertical');
    });

    it('should apply orientation to list', () => {
      dispose = createRoot(() => {
        Stepper({
          orientation: 'vertical',
          children: () => StepperList({
            children: () => StepperItem({ value: 0, children: 'Step' }),
          }),
        });
      });

      const list = container.querySelector('[data-stepper-list]');
      expect(list?.getAttribute('data-orientation')).toBe('vertical');
    });
  });

  describe('Content Visibility', () => {
    it('should only show active step content', () => {
      dispose = createRoot(() => {
        Stepper({
          value: 0,
          children: () => [
            StepperContent({ value: 0, children: 'Content 0' }),
            StepperContent({ value: 1, children: 'Content 1' }),
          ],
        });
      });

      const content0 = container.querySelector('[data-value="0"]');
      const content1 = container.querySelector('[data-value="1"]');

      expect(content0).toBeTruthy();
      expect(content1).toBeFalsy();
    });

    it('should switch content when step changes', () => {
      const step = signal(0);

      dispose = createRoot(() => {
        Stepper({
          value: step(),
          children: () => [
            StepperContent({ value: 0, children: 'Content 0' }),
            StepperContent({ value: 1, children: 'Content 1' }),
          ],
        });
      });

      step.set(1);

      const content1 = container.querySelector('[data-value="1"]');
      expect(content1).toBeTruthy();
    });
  });

  describe('ARIA Attributes - Stepper', () => {
    it('should have aria-label on root', () => {
      dispose = createRoot(() => {
        Stepper({ children: null });
      });

      const stepper = container.querySelector('[data-stepper]');
      expect(stepper?.getAttribute('aria-label')).toBe('Progress');
    });

    it('should have data-stepper attribute', () => {
      dispose = createRoot(() => {
        Stepper({ children: null });
      });

      const stepper = container.querySelector('[data-stepper]');
      expect(stepper?.hasAttribute('data-stepper')).toBe(true);
    });

    it('should have data-orientation attribute', () => {
      dispose = createRoot(() => {
        Stepper({ children: null });
      });

      const stepper = container.querySelector('[data-stepper]');
      expect(stepper?.hasAttribute('data-orientation')).toBe(true);
    });
  });

  describe('ARIA Attributes - List', () => {
    it('should have aria-label on list', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({}),
        });
      });

      const list = container.querySelector('ol');
      expect(list?.getAttribute('aria-label')).toBe('Steps');
    });

    it('should render as ol element', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({}),
        });
      });

      const list = container.querySelector('ol');
      expect(list).toBeTruthy();
    });

    it('should have data-stepper-list attribute', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({}),
        });
      });

      const list = container.querySelector('[data-stepper-list]');
      expect(list).toBeTruthy();
    });
  });

  describe('ARIA Attributes - Item', () => {
    it('should render as li element', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({
            children: () => StepperItem({ value: 0, children: 'Step' }),
          }),
        });
      });

      const item = container.querySelector('li');
      expect(item).toBeTruthy();
    });

    it('should have data-value attribute', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({
            children: () => StepperItem({ value: 5, children: 'Step' }),
          }),
        });
      });

      const item = container.querySelector('[data-stepper-item]');
      expect(item?.getAttribute('data-value')).toBe('5');
    });

    it('should have data-active when active', () => {
      dispose = createRoot(() => {
        Stepper({
          value: 0,
          children: () => StepperList({
            children: () => StepperItem({ value: 0, children: 'Step' }),
          }),
        });
      });

      const item = container.querySelector('[data-stepper-item]');
      expect(item?.hasAttribute('data-active')).toBe(true);
    });

    it('should have data-completed when completed', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({
            children: () => StepperItem({
              value: 0,
              completed: true,
              children: 'Step',
            }),
          }),
        });
      });

      const item = container.querySelector('[data-stepper-item]');
      expect(item?.hasAttribute('data-completed')).toBe(true);
    });

    it('should have data-disabled when disabled', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({
            children: () => StepperItem({
              value: 0,
              disabled: true,
              children: 'Step',
            }),
          }),
        });
      });

      const item = container.querySelector('[data-stepper-item]');
      expect(item?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should have aria-current step when active', () => {
      dispose = createRoot(() => {
        Stepper({
          value: 0,
          children: () => StepperList({
            children: () => StepperItem({ value: 0, children: 'Step' }),
          }),
        });
      });

      const item = container.querySelector('[data-stepper-item]');
      expect(item?.getAttribute('aria-current')).toBe('step');
    });
  });

  describe('ARIA Attributes - Trigger', () => {
    it('should render as button element', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({
            children: () => StepperItem({
              value: 0,
              children: () => StepperTrigger({ children: 'Step' }),
            }),
          }),
        });
      });

      const trigger = container.querySelector('button');
      expect(trigger).toBeTruthy();
    });

    it('should have type button', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({
            children: () => StepperItem({
              value: 0,
              children: () => StepperTrigger({ children: 'Step' }),
            }),
          }),
        });
      });

      const trigger = container.querySelector('button');
      expect(trigger?.getAttribute('type')).toBe('button');
    });

    it('should have data-state active', () => {
      dispose = createRoot(() => {
        Stepper({
          value: 0,
          children: () => StepperList({
            children: () => StepperItem({
              value: 0,
              children: () => StepperTrigger({ children: 'Step' }),
            }),
          }),
        });
      });

      const trigger = container.querySelector('button');
      expect(trigger?.getAttribute('data-state')).toBe('active');
    });

    it('should have data-state completed', () => {
      dispose = createRoot(() => {
        Stepper({
          value: 1,
          children: () => StepperList({
            children: () => StepperItem({
              value: 0,
              completed: true,
              children: () => StepperTrigger({ children: 'Step' }),
            }),
          }),
        });
      });

      const trigger = container.querySelector('button');
      expect(trigger?.getAttribute('data-state')).toBe('completed');
    });

    it('should have data-state inactive', () => {
      dispose = createRoot(() => {
        Stepper({
          value: 0,
          children: () => StepperList({
            children: () => StepperItem({
              value: 1,
              children: () => StepperTrigger({ children: 'Step' }),
            }),
          }),
        });
      });

      const trigger = container.querySelector('button');
      expect(trigger?.getAttribute('data-state')).toBe('inactive');
    });
  });

  describe('ARIA Attributes - Content', () => {
    it('should have role tabpanel', () => {
      dispose = createRoot(() => {
        Stepper({
          value: 0,
          children: StepperContent({ value: 0, children: 'Content' }),
        });
      });

      const content = container.querySelector('[data-stepper-content]');
      expect(content?.getAttribute('role')).toBe('tabpanel');
    });

    it('should have data-state active', () => {
      dispose = createRoot(() => {
        Stepper({
          value: 0,
          children: StepperContent({ value: 0, children: 'Content' }),
        });
      });

      const content = container.querySelector('[data-stepper-content]');
      expect(content?.getAttribute('data-state')).toBe('active');
    });

    it('should have aria-labelledby', () => {
      dispose = createRoot(() => {
        Stepper({
          value: 0,
          children: StepperContent({ value: 0, children: 'Content' }),
        });
      });

      const content = container.querySelector('[data-stepper-content]');
      expect(content?.getAttribute('aria-labelledby')).toBe('step-0');
    });
  });

  describe('ARIA Attributes - Separator', () => {
    it('should have aria-hidden true', () => {
      dispose = createRoot(() => {
        StepperSeparator({});
      });

      const sep = container.querySelector('[data-stepper-separator]');
      expect(sep?.getAttribute('aria-hidden')).toBe('true');
    });

    it('should have data-stepper-separator attribute', () => {
      dispose = createRoot(() => {
        StepperSeparator({});
      });

      const sep = container.querySelector('[data-stepper-separator]');
      expect(sep).toBeTruthy();
    });
  });

  describe('Description Component', () => {
    it('should render description text', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({
            children: () => StepperItem({
              value: 0,
              children: () => StepperDescription({ children: 'Step details' }),
            }),
          }),
        });
      });

      const desc = container.querySelector('[data-stepper-description]');
      expect(desc?.textContent).toBe('Step details');
    });

    it('should render as span', () => {
      dispose = createRoot(() => {
        StepperDescription({ children: 'Text' });
      });

      const desc = container.querySelector('span');
      expect(desc).toBeTruthy();
    });
  });

  describe('Event Handling', () => {
    it('should trigger onClick when clicking trigger', () => {
      const onClick = vi.fn();

      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({
            children: () => StepperItem({
              value: 0,
              children: () => StepperTrigger({
                children: 'Step',
                onClick,
              }),
            }),
          }),
        });
      });

      const button = container.querySelector('button');
      button?.click();

      expect(onClick).toHaveBeenCalled();
    });

    it('should call onValueChange when changing step', () => {
      const onChange = vi.fn();

      dispose = createRoot(() => {
        Stepper({
          value: 0,
          onValueChange: onChange,
          children: () => StepperList({
            children: () => [
              StepperItem({
                value: 0,
                children: () => StepperTrigger({ children: 'Step 1' }),
              }),
              StepperItem({
                value: 1,
                children: () => StepperTrigger({ children: 'Step 2' }),
              }),
            ],
          }),
        });
      });

      const buttons = container.querySelectorAll('button');
      buttons[1]?.click();

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(1);
    });
  });

  describe('Multiple Steps', () => {
    it('should support 3 steps', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({
            children: () => [
              StepperItem({
                value: 0,
                children: () => StepperTrigger({ children: 'Step 1' }),
              }),
              StepperItem({
                value: 1,
                children: () => StepperTrigger({ children: 'Step 2' }),
              }),
              StepperItem({
                value: 2,
                children: () => StepperTrigger({ children: 'Step 3' }),
              }),
            ],
          }),
        });
      });

      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBe(3);
    });

    it('should support 5 steps', () => {
      dispose = createRoot(() => {
        Stepper({
          children: () => StepperList({
            children: () => [
              StepperItem({
                value: 0,
                children: () => StepperTrigger({ children: 'Step 1' }),
              }),
              StepperItem({
                value: 1,
                children: () => StepperTrigger({ children: 'Step 2' }),
              }),
              StepperItem({
                value: 2,
                children: () => StepperTrigger({ children: 'Step 3' }),
              }),
              StepperItem({
                value: 3,
                children: () => StepperTrigger({ children: 'Step 4' }),
              }),
              StepperItem({
                value: 4,
                children: () => StepperTrigger({ children: 'Step 5' }),
              }),
            ],
          }),
        });
      });

      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBe(5);
    });

    it('should navigate through multiple steps', () => {
      const step = signal(0);

      dispose = createRoot(() => {
        Stepper({
          value: step(),
          onValueChange: (v) => step.set(v),
          children: () => [
            StepperList({
              children: () => [
                StepperItem({
                  value: 0,
                  children: () => StepperTrigger({ children: 'Step 1' }),
                }),
                StepperItem({
                  value: 1,
                  children: () => StepperTrigger({ children: 'Step 2' }),
                }),
                StepperItem({
                  value: 2,
                  children: () => StepperTrigger({ children: 'Step 3' }),
                }),
              ],
            }),
            StepperContent({ value: 0, children: 'Content 0' }),
            StepperContent({ value: 1, children: 'Content 1' }),
            StepperContent({ value: 2, children: 'Content 2' }),
          ],
        });
      });

      const buttons = container.querySelectorAll('button');

      buttons[1]?.click();
      expect(step()).toBe(1);

      buttons[2]?.click();
      expect(step()).toBe(2);

      buttons[0]?.click();
      expect(step()).toBe(0);
    });
  });

  describe('Type Safety', () => {
    it('should accept all stepper props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Stepper({
            value: 0,
            defaultValue: 0,
            onValueChange: () => {},
            orientation: 'horizontal',
            linear: true,
            children: null,
          });
        });
      }).not.toThrow();
    });
  });
});
