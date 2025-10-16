/**
 * Toolbar component tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../../src/core/index.js';
import { Toolbar, getDefaultToolbarItems } from '../../../../src/components/editor/components/Toolbar.js';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';
import type { ToolbarItem } from '../../../../src/components/editor/components/Toolbar.js';

describe('Toolbar', () => {
  let mockEditor: EditorInstance;
  let editorSignal: ReturnType<typeof signal<EditorInstance | null>>;

  beforeEach(() => {
    mockEditor = {
      commands: {
        execute: vi.fn(() => true),
        can: vi.fn(() => true),
        chain: vi.fn(),
      },
      state: {} as any,
      view: {} as any,
      schema: {} as any,
      signals: {} as any,
      getHTML: vi.fn(),
      getJSON: vi.fn(),
      getText: vi.fn(),
      setContent: vi.fn(),
      clearContent: vi.fn(),
      focus: vi.fn(),
      blur: vi.fn(),
      isEmpty: vi.fn(() => false),
      isFocused: vi.fn(() => false),
      isEditable: vi.fn(() => true),
      destroy: vi.fn(),
    };
    editorSignal = signal<EditorInstance | null>(mockEditor);
  });

  it('should be defined', () => {
    expect(Toolbar).toBeDefined();
    expect(typeof Toolbar).toBe('function');
  });

  it('should have displayName', () => {
    expect(Toolbar.displayName).toBe('Toolbar');
  });

  it('should render toolbar with default items', () => {
    const element = Toolbar({ editor: editorSignal }) as HTMLElement;

    expect(element).toBeDefined();
    expect(element.classList.contains('toolbar')).toBe(true);
  });

  it('should render toolbar with custom items', () => {
    const customItems: ToolbarItem[] = [
      {
        type: 'button',
        icon: 'T',
        title: 'Test',
        command: 'test',
      },
    ];

    const element = Toolbar({ editor: editorSignal, items: customItems }) as HTMLElement;

    expect(element).toBeDefined();
    expect(element.classList.contains('toolbar')).toBe(true);
  });

  it('should apply custom class', () => {
    const element = Toolbar({ editor: editorSignal, class: 'custom-toolbar' }) as HTMLElement;

    expect(element.classList.contains('toolbar')).toBe(true);
    expect(element.classList.contains('custom-toolbar')).toBe(true);
  });

  it('should apply sticky class', () => {
    const element = Toolbar({ editor: editorSignal, sticky: true }) as HTMLElement;

    expect(element.classList.contains('toolbar')).toBe(true);
    expect(element.classList.contains('sticky')).toBe(true);
  });

  it('should render button items', () => {
    const items: ToolbarItem[] = [
      {
        type: 'button',
        icon: 'B',
        title: 'Bold',
        command: 'bold',
      },
    ];

    const element = Toolbar({ editor: editorSignal, items }) as HTMLElement;

    const button = element.querySelector('.toolbar-button');
    expect(button).toBeDefined();
    expect(button?.textContent).toBe('B');
  });

  it('should execute command on button click', () => {
    const items: ToolbarItem[] = [
      {
        type: 'button',
        icon: 'B',
        title: 'Bold',
        command: 'bold',
      },
    ];

    const element = Toolbar({ editor: editorSignal, items }) as HTMLElement;

    const button = element.querySelector('.toolbar-button') as HTMLButtonElement;
    button?.click();

    expect(mockEditor.commands?.execute).toHaveBeenCalledWith('bold');
  });

  it('should execute command with args', () => {
    const items: ToolbarItem[] = [
      {
        type: 'button',
        icon: 'H1',
        title: 'Heading 1',
        command: 'heading',
        args: [1],
      },
    ];

    const element = Toolbar({ editor: editorSignal, items }) as HTMLElement;

    const button = element.querySelector('.toolbar-button') as HTMLButtonElement;
    button?.click();

    expect(mockEditor.commands?.execute).toHaveBeenCalledWith('heading', 1);
  });

  it('should not execute command when editor is null', () => {
    editorSignal.set(null);

    const items: ToolbarItem[] = [
      {
        type: 'button',
        icon: 'B',
        title: 'Bold',
        command: 'bold',
      },
    ];

    const element = Toolbar({ editor: editorSignal, items }) as HTMLElement;

    const button = element.querySelector('.toolbar-button') as HTMLButtonElement;
    button?.click();

    expect(mockEditor.commands?.execute).not.toHaveBeenCalled();
  });

  it('should apply active class based on isActive callback', () => {
    const items: ToolbarItem[] = [
      {
        type: 'button',
        icon: 'B',
        title: 'Bold',
        command: 'bold',
        isActive: (editor) => true,
      },
    ];

    const element = Toolbar({ editor: editorSignal, items }) as HTMLElement;

    const button = element.querySelector('.toolbar-button') as HTMLButtonElement;
    expect(button?.classList.contains('active')).toBe(true);
  });

  it('should not apply active class when isActive returns false', () => {
    const items: ToolbarItem[] = [
      {
        type: 'button',
        icon: 'B',
        title: 'Bold',
        command: 'bold',
        isActive: (editor) => false,
      },
    ];

    const element = Toolbar({ editor: editorSignal, items }) as HTMLElement;

    const button = element.querySelector('.toolbar-button') as HTMLButtonElement;
    expect(button?.classList.contains('active')).toBe(false);
  });

  it('should disable button based on isDisabled callback', () => {
    const items: ToolbarItem[] = [
      {
        type: 'button',
        icon: 'B',
        title: 'Bold',
        command: 'bold',
        isDisabled: (editor) => true,
      },
    ];

    const element = Toolbar({ editor: editorSignal, items }) as HTMLElement;

    const button = element.querySelector('.toolbar-button') as HTMLButtonElement;
    expect(button?.disabled).toBe(true);
    expect(button?.classList.contains('disabled')).toBe(true);
  });

  it('should not execute command when button is disabled', () => {
    const items: ToolbarItem[] = [
      {
        type: 'button',
        icon: 'B',
        title: 'Bold',
        command: 'bold',
        isDisabled: (editor) => true,
      },
    ];

    const element = Toolbar({ editor: editorSignal, items }) as HTMLElement;

    const button = element.querySelector('.toolbar-button') as HTMLButtonElement;
    button?.click();

    expect(mockEditor.commands?.execute).not.toHaveBeenCalled();
  });

  it('should render divider items', () => {
    const items: ToolbarItem[] = [{ type: 'divider' }];

    const element = Toolbar({ editor: editorSignal, items }) as HTMLElement;

    const divider = element.querySelector('.toolbar-divider');
    expect(divider).toBeDefined();
  });

  it('should render group items', () => {
    const items: ToolbarItem[] = [
      {
        type: 'group',
        items: [
          {
            type: 'button',
            icon: 'B',
            title: 'Bold',
            command: 'bold',
          },
          {
            type: 'button',
            icon: 'I',
            title: 'Italic',
            command: 'italic',
          },
        ],
      },
    ];

    const element = Toolbar({ editor: editorSignal, items }) as HTMLElement;

    const group = element.querySelector('.toolbar-group');
    expect(group).toBeDefined();

    const buttons = group?.querySelectorAll('.toolbar-button');
    expect(buttons?.length).toBe(2);
  });

  it('should render dropdown items', () => {
    const items: ToolbarItem[] = [
      {
        type: 'dropdown',
        icon: 'H',
        title: 'Heading',
        items: [
          {
            type: 'button',
            icon: 'H1',
            title: 'Heading 1',
            command: 'heading',
            args: [1],
          },
          {
            type: 'button',
            icon: 'H2',
            title: 'Heading 2',
            command: 'heading',
            args: [2],
          },
        ],
      },
    ];

    const element = Toolbar({ editor: editorSignal, items }) as HTMLElement;

    const dropdown = element.querySelector('.toolbar-dropdown');
    expect(dropdown).toBeDefined();

    const trigger = dropdown?.querySelector('.toolbar-dropdown-trigger');
    expect(trigger).toBeDefined();
    expect(trigger?.textContent).toBe('H');

    const menu = dropdown?.querySelector('.toolbar-dropdown-menu');
    expect(menu).toBeDefined();

    const buttons = menu?.querySelectorAll('.toolbar-button');
    expect(buttons?.length).toBe(2);
  });

  it('should toggle dropdown menu on trigger click', () => {
    const items: ToolbarItem[] = [
      {
        type: 'dropdown',
        icon: 'H',
        title: 'Heading',
        items: [
          {
            type: 'button',
            icon: 'H1',
            title: 'Heading 1',
            command: 'heading',
            args: [1],
          },
        ],
      },
    ];

    const element = Toolbar({ editor: editorSignal, items }) as HTMLElement;

    const dropdown = element.querySelector('.toolbar-dropdown');
    const trigger = dropdown?.querySelector('.toolbar-dropdown-trigger') as HTMLButtonElement;
    const menu = dropdown?.querySelector('.toolbar-dropdown-menu') as HTMLElement;

    // Initially not open
    expect(menu?.classList.contains('open')).toBe(false);

    // Click to open
    trigger?.click();
    expect(menu?.classList.contains('open')).toBe(true);

    // Click to close
    trigger?.click();
    expect(menu?.classList.contains('open')).toBe(false);
  });

  it('should render default toolbar items', () => {
    const defaultItems = getDefaultToolbarItems();
    expect(defaultItems.length).toBeGreaterThan(0);

    // Check for groups
    const groups = defaultItems.filter((item) => item.type === 'group');
    expect(groups.length).toBeGreaterThan(0);

    // Check for dividers
    const dividers = defaultItems.filter((item) => item.type === 'divider');
    expect(dividers.length).toBeGreaterThan(0);

    // Check for dropdown
    const dropdowns = defaultItems.filter((item) => item.type === 'dropdown');
    expect(dropdowns.length).toBeGreaterThan(0);
  });

  it('should handle mixed item types', () => {
    const items: ToolbarItem[] = [
      {
        type: 'button',
        icon: 'B',
        title: 'Bold',
        command: 'bold',
      },
      { type: 'divider' },
      {
        type: 'group',
        items: [
          {
            type: 'button',
            icon: 'I',
            title: 'Italic',
            command: 'italic',
          },
        ],
      },
      { type: 'divider' },
      {
        type: 'dropdown',
        icon: 'H',
        title: 'Heading',
        items: [
          {
            type: 'button',
            icon: 'H1',
            title: 'Heading 1',
            command: 'heading',
            args: [1],
          },
        ],
      },
    ];

    const element = Toolbar({ editor: editorSignal, items }) as HTMLElement;

    expect(element.querySelector('.toolbar-button')).toBeDefined();
    expect(element.querySelectorAll('.toolbar-divider').length).toBe(2);
    expect(element.querySelector('.toolbar-group')).toBeDefined();
    expect(element.querySelector('.toolbar-dropdown')).toBeDefined();
  });
});
