/**
 * TaskListExtension and TaskItemExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { Schema } from 'prosemirror-model';
import { TaskListExtension } from '../../../../../src/components/editor/extensions/lists/TaskListExtension.js';
import { TaskItemExtension } from '../../../../../src/components/editor/extensions/lists/TaskItemExtension.js';

describe('TaskItemExtension', () => {
  let extension: TaskItemExtension;

  beforeEach(() => {
    extension = new TaskItemExtension();
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('task_item');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should have no dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('schema', () => {
    it('should provide task_item node schema', () => {
      const schema = extension.getSchema();
      expect(schema).toBeDefined();
      expect(schema?.nodes?.task_item).toBeDefined();
    });

    it('should have checked attribute with default of false', () => {
      const schema = extension.getSchema();
      const nodeSpec = schema?.nodes?.task_item;
      expect(nodeSpec?.attrs).toBeDefined();
      expect(nodeSpec?.attrs?.checked).toEqual({ default: false });
    });

    it('should define content as "paragraph block*"', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.task_item?.content).toBe('paragraph block*');
    });

    it('should be a defining node', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.task_item?.defining).toBe(true);
    });

    it('should parse from li tags with data-type="task_item"', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.task_item?.parseDOM;
      expect(parseDOM).toBeDefined();
      expect(parseDOM?.length).toBeGreaterThan(0);
      expect(parseDOM?.[0].tag).toBe('li[data-type="task_item"]');
      expect(typeof parseDOM?.[0].getAttrs).toBe('function');
    });

    it('should extract checked attribute when parsing', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.task_item?.parseDOM;
      const getAttrs = parseDOM?.[0].getAttrs;

      if (getAttrs && typeof getAttrs === 'function') {
        // Mock DOM element with checked=true
        const mockElement = {
          getAttribute: (name: string) => (name === 'data-checked' ? 'true' : null),
        } as any;

        const attrs = getAttrs(mockElement);
        expect(attrs).toEqual({ checked: true });
      }
    });

    it('should render to li tags with data attributes', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.task_item?.toDOM;
      expect(toDOM).toBeDefined();
      expect(typeof toDOM).toBe('function');
    });

    it('should render with checked=false by default', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.task_item?.toDOM;

      if (toDOM && typeof toDOM === 'function') {
        const node = { attrs: { checked: false } } as any;
        const result = toDOM(node);
        expect(result).toEqual([
          'li',
          {
            'data-type': 'task_item',
            'data-checked': false,
          },
          0,
        ]);
      }
    });

    it('should render with checked=true when checked', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.task_item?.toDOM;

      if (toDOM && typeof toDOM === 'function') {
        const node = { attrs: { checked: true } } as any;
        const result = toDOM(node);
        expect(result).toEqual([
          'li',
          {
            'data-type': 'task_item',
            'data-checked': true,
          },
          0,
        ]);
      }
    });
  });

  describe('commands', () => {
    it('should provide toggleTaskItem command', () => {
      const commands = extension.getCommands();
      expect(commands).toBeDefined();
      expect(commands?.toggleTaskItem).toBeDefined();
      expect(typeof commands?.toggleTaskItem).toBe('function');
    });
  });
});

describe('TaskListExtension', () => {
  let extension: TaskListExtension;

  beforeEach(() => {
    extension = new TaskListExtension();
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('task_list');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should depend on task_item', () => {
      expect(extension.dependencies).toEqual(['task_item']);
    });
  });

  describe('schema', () => {
    it('should provide task_list node schema', () => {
      const schema = extension.getSchema();
      expect(schema).toBeDefined();
      expect(schema?.nodes?.task_list).toBeDefined();
    });

    it('should define content as "task_item+"', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.task_list?.content).toBe('task_item+');
    });

    it('should be in block group', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.task_list?.group).toBe('block');
    });

    it('should parse from ul tags with data-type="task_list"', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.task_list?.parseDOM;
      expect(parseDOM).toBeDefined();
      expect(parseDOM).toEqual([{ tag: 'ul[data-type="task_list"]' }]);
    });

    it('should render to ul tags with data-type attribute', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.task_list?.toDOM;
      expect(toDOM).toBeDefined();
      if (toDOM && typeof toDOM === 'function') {
        const result = toDOM({} as any);
        expect(result).toEqual(['ul', { 'data-type': 'task_list' }, 0]);
      }
    });
  });

  describe('commands', () => {
    it('should provide taskList command', () => {
      const commands = extension.getCommands();
      expect(commands).toBeDefined();
      expect(commands?.taskList).toBeDefined();
      expect(typeof commands?.taskList).toBe('function');
    });

    it('should provide toggleTaskList command', () => {
      const commands = extension.getCommands();
      expect(commands).toBeDefined();
      expect(commands?.toggleTaskList).toBeDefined();
      expect(typeof commands?.toggleTaskList).toBe('function');
    });
  });

  describe('input rules', () => {
    it('should provide input rules', () => {
      const schema = createTestSchema();

      const inputRules = extension.getInputRules(schema);
      expect(inputRules).toBeDefined();
      expect(Array.isArray(inputRules)).toBe(true);
      expect(inputRules?.length).toBeGreaterThan(0);
    });

    it('should have input rule for markdown task list syntax', () => {
      const schema = createTestSchema();

      const inputRules = extension.getInputRules(schema);
      expect(inputRules).toBeDefined();
      expect(inputRules?.length).toBeGreaterThan(0);

      // The input rule should match "[ ] " at start of line
      const rule = inputRules![0];
      expect(rule).toBeDefined();
    });
  });

  describe('integration', () => {
    it('should work with task_item extension to create complete schema', () => {
      const taskListExt = new TaskListExtension();
      const taskItemExt = new TaskItemExtension();

      const taskListSchema = taskListExt.getSchema();
      const taskItemSchema = taskItemExt.getSchema();

      const nodes = {
        doc: {
          content: 'block+',
        },
        text: {
          group: 'inline',
        },
        paragraph: {
          content: 'inline*',
          group: 'block',
          parseDOM: [{ tag: 'p' }],
          toDOM: () => ['p', 0],
        },
        ...taskItemSchema?.nodes,
        ...taskListSchema?.nodes,
      };

      const schema = new Schema({ nodes });

      expect(schema.nodes.task_list).toBeDefined();
      expect(schema.nodes.task_item).toBeDefined();

      // The task_list should accept task_item as content
      const taskListNode = schema.nodes.task_list;
      expect(taskListNode.contentMatch).toBeDefined();
    });
  });
});

/**
 * Helper to create a test schema
 */
function createTestSchema() {
  const taskItemExt = new TaskItemExtension();
  const taskListExt = new TaskListExtension();

  const taskItemSchema = taskItemExt.getSchema();
  const taskListSchema = taskListExt.getSchema();

  return new Schema({
    nodes: {
      doc: {
        content: 'block+',
      },
      text: {
        group: 'inline',
      },
      paragraph: {
        content: 'inline*',
        group: 'block',
        parseDOM: [{ tag: 'p' }],
        toDOM: () => ['p', 0],
      },
      ...taskItemSchema?.nodes,
      ...taskListSchema?.nodes,
    },
  });
}
