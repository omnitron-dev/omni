/**
 * TableHeaderExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Schema } from 'prosemirror-model';
import { TableHeaderExtension } from '../../../../../src/components/editor/extensions/table/TableHeaderExtension.js';

describe('TableHeaderExtension', () => {
  let extension: TableHeaderExtension;

  beforeEach(() => {
    extension = new TableHeaderExtension();
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('table_header');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('node');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('options', () => {
    it('should have default options', () => {
      const options = extension.getOptions();
      expect(options.HTMLAttributes).toEqual({});
    });

    it('should allow custom HTML attributes', () => {
      const customExt = new TableHeaderExtension({
        HTMLAttributes: { class: 'custom-header' },
      });
      const options = customExt.getOptions();
      expect(options.HTMLAttributes).toEqual({ class: 'custom-header' });
    });

    it('should allow configuration after creation', () => {
      extension.configure({ HTMLAttributes: { class: 'configured-header' } });
      expect(extension.getOptions().HTMLAttributes).toEqual({ class: 'configured-header' });
    });
  });

  describe('schema', () => {
    it('should provide table_header node schema', () => {
      const schema = extension.getSchema();
      expect(schema).toBeDefined();
      expect(schema?.nodes?.table_header).toBeDefined();
    });

    it('should define content as "block+"', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_header?.content).toBe('block+');
    });

    it('should have tableRole set to "header_cell"', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_header?.tableRole).toBe('header_cell');
    });

    it('should be isolating', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_header?.isolating).toBe(true);
    });

    it('should have colspan attribute with default 1', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_header?.attrs?.colspan).toEqual({ default: 1 });
    });

    it('should have rowspan attribute with default 1', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_header?.attrs?.rowspan).toEqual({ default: 1 });
    });

    it('should have colwidth attribute with default null', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_header?.attrs?.colwidth).toEqual({ default: null });
    });

    it('should parse from th tags', () => {
      const schema = extension.getSchema();
      expect(schema?.nodes?.table_header?.parseDOM).toBeDefined();
      expect(schema?.nodes?.table_header?.parseDOM?.[0]?.tag).toBe('th');
    });

    it('should render to th tags', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_header?.toDOM;
      expect(toDOM).toBeDefined();
      if (toDOM && typeof toDOM === 'function') {
        const result = toDOM({ attrs: { colspan: 1, rowspan: 1, colwidth: null } } as any);
        expect(result[0]).toBe('th');
      }
    });
  });

  describe('attribute parsing', () => {
    it('should parse colspan attribute', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.table_header?.parseDOM?.[0];
      expect(parseDOM?.getAttrs).toBeDefined();

      const mockElement = {
        getAttribute: (name: string) => (name === 'colspan' ? '3' : null),
      } as unknown as HTMLElement;

      const attrs = parseDOM?.getAttrs?.(mockElement);
      expect(attrs).toEqual({
        colspan: 3,
        rowspan: 1,
        colwidth: null,
      });
    });

    it('should parse rowspan attribute', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.table_header?.parseDOM?.[0];

      const mockElement = {
        getAttribute: (name: string) => (name === 'rowspan' ? '2' : null),
      } as unknown as HTMLElement;

      const attrs = parseDOM?.getAttrs?.(mockElement);
      expect(attrs).toEqual({
        colspan: 1,
        rowspan: 2,
        colwidth: null,
      });
    });

    it('should parse colwidth attribute', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.table_header?.parseDOM?.[0];

      const mockElement = {
        getAttribute: (name: string) => (name === 'colwidth' ? '100,200' : null),
      } as unknown as HTMLElement;

      const attrs = parseDOM?.getAttrs?.(mockElement);
      expect(attrs).toEqual({
        colspan: 1,
        rowspan: 1,
        colwidth: [100, 200],
      });
    });

    it('should default to 1 when colspan is not provided', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.table_header?.parseDOM?.[0];

      const mockElement = {
        getAttribute: () => null,
      } as unknown as HTMLElement;

      const attrs = parseDOM?.getAttrs?.(mockElement);
      expect(attrs.colspan).toBe(1);
    });

    it('should default to 1 when rowspan is not provided', () => {
      const schema = extension.getSchema();
      const parseDOM = schema?.nodes?.table_header?.parseDOM?.[0];

      const mockElement = {
        getAttribute: () => null,
      } as unknown as HTMLElement;

      const attrs = parseDOM?.getAttrs?.(mockElement);
      expect(attrs.rowspan).toBe(1);
    });
  });

  describe('attribute serialization', () => {
    it('should omit colspan when it is 1', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_header?.toDOM;

      const result = toDOM?.({ attrs: { colspan: 1, rowspan: 1, colwidth: null } } as any);
      expect(result).toBeDefined();
      expect(result![1]).toEqual({});
    });

    it('should include colspan when it is not 1', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_header?.toDOM;

      const result = toDOM?.({ attrs: { colspan: 3, rowspan: 1, colwidth: null } } as any);
      expect(result).toBeDefined();
      expect(result![1]).toHaveProperty('colspan', 3);
    });

    it('should omit rowspan when it is 1', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_header?.toDOM;

      const result = toDOM?.({ attrs: { colspan: 1, rowspan: 1, colwidth: null } } as any);
      expect(result).toBeDefined();
      expect(result![1]).toEqual({});
    });

    it('should include rowspan when it is not 1', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_header?.toDOM;

      const result = toDOM?.({ attrs: { colspan: 1, rowspan: 2, colwidth: null } } as any);
      expect(result).toBeDefined();
      expect(result![1]).toHaveProperty('rowspan', 2);
    });

    it('should include colwidth as comma-separated string', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_header?.toDOM;

      const result = toDOM?.({
        attrs: { colspan: 1, rowspan: 1, colwidth: [100, 200] },
      } as any);
      expect(result).toBeDefined();
      expect(result![1]).toHaveProperty('colwidth', '100,200');
    });

    it('should include style with width when colwidth is set', () => {
      const schema = extension.getSchema();
      const toDOM = schema?.nodes?.table_header?.toDOM;

      const result = toDOM?.({
        attrs: { colspan: 1, rowspan: 1, colwidth: [150] },
      } as any);
      expect(result).toBeDefined();
      expect(result![1]).toHaveProperty('style', 'width: 150px');
    });

    it('should apply custom HTML attributes', () => {
      const customExt = new TableHeaderExtension({
        HTMLAttributes: { class: 'custom-header', 'data-test': 'true' },
      });
      const schema = customExt.getSchema();
      const toDOM = schema?.nodes?.table_header?.toDOM;

      const result = toDOM?.({ attrs: { colspan: 1, rowspan: 1, colwidth: null } } as any);
      expect(result).toBeDefined();
      expect(result![1]).toHaveProperty('class', 'custom-header');
      expect(result![1]).toHaveProperty('data-test', 'true');
    });

    it('should merge custom attributes with span attributes', () => {
      const customExt = new TableHeaderExtension({
        HTMLAttributes: { class: 'custom-header' },
      });
      const schema = customExt.getSchema();
      const toDOM = schema?.nodes?.table_header?.toDOM;

      const result = toDOM?.({ attrs: { colspan: 2, rowspan: 3, colwidth: null } } as any);
      expect(result).toBeDefined();
      expect(result![1]).toHaveProperty('class', 'custom-header');
      expect(result![1]).toHaveProperty('colspan', 2);
      expect(result![1]).toHaveProperty('rowspan', 3);
    });
  });

  describe('content validation', () => {
    it('should require at least one block element', () => {
      const headerSchema = extension.getSchema();

      const schema = new Schema({
        nodes: {
          doc: { content: 'table_header+' },
          text: { group: 'inline' },
          paragraph: {
            content: 'inline*',
            group: 'block',
            parseDOM: [{ tag: 'p' }],
            toDOM: () => ['p', 0],
          },
          ...headerSchema?.nodes,
        },
      });

      // Content is "block+" which means at least one block element
      const headerSpec = schema.nodes.table_header.spec;
      expect(headerSpec.content).toBe('block+');

      // Creating a header with a paragraph should succeed
      const p = schema.nodes.paragraph.create();
      const header = schema.nodes.table_header.create(null, p);
      expect(header).toBeDefined();
      expect(header.childCount).toBe(1);

      // createAndFill should automatically add required content
      const filledHeader = schema.nodes.table_header.createAndFill();
      expect(filledHeader).toBeDefined();
      expect(filledHeader!.childCount).toBeGreaterThan(0);
    });
  });

  describe('difference from TableCell', () => {
    it('should use different tag (th vs td)', () => {
      const headerSchema = extension.getSchema();
      const toDOM = headerSchema?.nodes?.table_header?.toDOM;

      const result = toDOM?.({ attrs: { colspan: 1, rowspan: 1, colwidth: null } } as any);
      expect(result![0]).toBe('th');
    });

    it('should have different tableRole (header_cell vs cell)', () => {
      const headerSchema = extension.getSchema();
      expect(headerSchema?.nodes?.table_header?.tableRole).toBe('header_cell');
    });
  });

  describe('no extra functionality', () => {
    it('should not provide commands', () => {
      const commands = extension.getCommands?.();
      expect(commands).toBeUndefined();
    });

    it('should not provide keyboard shortcuts', () => {
      const shortcuts = extension.getKeyboardShortcuts?.();
      expect(shortcuts).toBeUndefined();
    });

    it('should not provide plugins', () => {
      const plugins = extension.getPlugins?.();
      expect(plugins).toBeUndefined();
    });

    it('should not provide input rules', () => {
      const inputRules = extension.getInputRules?.();
      expect(inputRules).toBeUndefined();
    });
  });
});
