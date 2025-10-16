/**
 * MarkdownExtension tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { Schema, DOMParser } from 'prosemirror-model';
import { MarkdownExtension } from '../../../../../src/components/editor/extensions/markdown/MarkdownExtension.js';
import { parseMarkdown } from '../../../../../src/components/editor/extensions/markdown/parser.js';
import { serializeToMarkdown } from '../../../../../src/components/editor/extensions/markdown/serializer.js';
import { SchemaBuilder } from '../../../../../src/components/editor/core/SchemaBuilder.js';
import { BoldExtension } from '../../../../../src/components/editor/extensions/marks/BoldExtension.js';
import { ItalicExtension } from '../../../../../src/components/editor/extensions/marks/ItalicExtension.js';
import { CodeExtension } from '../../../../../src/components/editor/extensions/marks/CodeExtension.js';
import { StrikeExtension } from '../../../../../src/components/editor/extensions/marks/StrikeExtension.js';
import { HeadingExtension } from '../../../../../src/components/editor/extensions/nodes/HeadingExtension.js';
import { ParagraphExtension } from '../../../../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { BlockquoteExtension } from '../../../../../src/components/editor/extensions/nodes/BlockquoteExtension.js';
import { HorizontalRuleExtension } from '../../../../../src/components/editor/extensions/nodes/HorizontalRuleExtension.js';
import { BulletListExtension } from '../../../../../src/components/editor/extensions/lists/BulletListExtension.js';
import { OrderedListExtension } from '../../../../../src/components/editor/extensions/lists/OrderedListExtension.js';
import { ListItemExtension } from '../../../../../src/components/editor/extensions/lists/ListItemExtension.js';
import { CodeBlockExtension } from '../../../../../src/components/editor/extensions/code/CodeBlockExtension.js';
import { LinkExtension } from '../../../../../src/components/editor/extensions/media/LinkExtension.js';

describe('MarkdownExtension', () => {
  let extension: MarkdownExtension;
  let schema: Schema;

  beforeEach(() => {
    // Create schema with all necessary extensions
    const builder = new SchemaBuilder();

    const extensions = [
      new BoldExtension(),
      new ItalicExtension(),
      new CodeExtension(),
      new StrikeExtension(),
      new HeadingExtension(),
      new ParagraphExtension(),
      new BlockquoteExtension(),
      new HorizontalRuleExtension(),
      new BulletListExtension(),
      new OrderedListExtension(),
      new ListItemExtension(),
      new CodeBlockExtension(),
      new LinkExtension(),
    ];

    extensions.forEach((ext) => {
      const schemaSpec = ext.getSchema();
      if (schemaSpec?.nodes) {
        Object.entries(schemaSpec.nodes).forEach(([name, spec]) => {
          builder.addNode(name, spec);
        });
      }
      if (schemaSpec?.marks) {
        Object.entries(schemaSpec.marks).forEach(([name, spec]) => {
          builder.addMark(name, spec);
        });
      }
    });

    schema = builder.build();
    extension = new MarkdownExtension();
  });

  describe('Extension metadata', () => {
    it('should have correct name', () => {
      expect(extension.name).toBe('markdown');
    });

    it('should have correct type', () => {
      expect(extension.type).toBe('behavior');
    });

    it('should not have dependencies', () => {
      expect(extension.dependencies).toBeUndefined();
    });
  });

  describe('Options', () => {
    it('should have default options', () => {
      const options = extension.getOptions();
      expect(options.convertOnInput).toBe(true);
      expect(options.convertOnPaste).toBe(true);
      expect(options.gfm).toBe(true);
    });

    it('should allow configuration', () => {
      extension.configure({ convertOnInput: false });
      expect(extension.getOptions().convertOnInput).toBe(false);
    });

    it('should allow disabling GFM', () => {
      extension.configure({ gfm: false });
      expect(extension.getOptions().gfm).toBe(false);
    });
  });

  describe('Plugins', () => {
    it('should provide paste plugin when convertOnPaste is true', () => {
      const plugins = extension.getPlugins();
      expect(plugins).toBeDefined();
      expect(plugins?.length).toBeGreaterThan(0);
    });

    it('should not provide plugins when convertOnPaste is false', () => {
      extension.configure({ convertOnPaste: false });
      const plugins = extension.getPlugins();
      expect(plugins).toBeDefined();
      expect(plugins?.length).toBe(0);
    });
  });

  describe('Markdown detection', () => {
    it('should detect headings', () => {
      const markdown = '# Hello World';
      const result = extension['looksLikeMarkdown'](markdown);
      expect(result).toBe(true);
    });

    it('should detect bold text', () => {
      const markdown = '**bold text**';
      const result = extension['looksLikeMarkdown'](markdown);
      expect(result).toBe(true);
    });

    it('should detect italic text', () => {
      const markdown = '*italic text*';
      const result = extension['looksLikeMarkdown'](markdown);
      expect(result).toBe(true);
    });

    it('should detect code blocks', () => {
      const markdown = '```javascript\nconst x = 1;\n```';
      const result = extension['looksLikeMarkdown'](markdown);
      expect(result).toBe(true);
    });

    it('should detect links', () => {
      const markdown = '[link](http://example.com)';
      const result = extension['looksLikeMarkdown'](markdown);
      expect(result).toBe(true);
    });

    it('should detect blockquotes', () => {
      const markdown = '> quote';
      const result = extension['looksLikeMarkdown'](markdown);
      expect(result).toBe(true);
    });

    it('should detect unordered lists', () => {
      const markdown = '- item';
      const result = extension['looksLikeMarkdown'](markdown);
      expect(result).toBe(true);
    });

    it('should detect ordered lists', () => {
      const markdown = '1. item';
      const result = extension['looksLikeMarkdown'](markdown);
      expect(result).toBe(true);
    });

    it('should detect tables when GFM is enabled', () => {
      const markdown = '| Header |\n|--------|\n| Cell   |';
      const result = extension['looksLikeMarkdown'](markdown);
      expect(result).toBe(true);
    });

    it('should detect strikethrough when GFM is enabled', () => {
      const markdown = '~~strikethrough~~';
      const result = extension['looksLikeMarkdown'](markdown);
      expect(result).toBe(true);
    });

    it('should not detect plain text', () => {
      const markdown = 'just plain text';
      const result = extension['looksLikeMarkdown'](markdown);
      expect(result).toBe(false);
    });
  });
});

describe('Markdown Parser', () => {
  let schema: Schema;

  beforeEach(() => {
    const builder = new SchemaBuilder();

    const extensions = [
      new BoldExtension(),
      new ItalicExtension(),
      new CodeExtension(),
      new StrikeExtension(),
      new HeadingExtension(),
      new ParagraphExtension(),
      new BlockquoteExtension(),
      new HorizontalRuleExtension(),
      new BulletListExtension(),
      new OrderedListExtension(),
      new ListItemExtension(),
      new CodeBlockExtension(),
      new LinkExtension(),
    ];

    extensions.forEach((ext) => {
      const schemaSpec = ext.getSchema();
      if (schemaSpec?.nodes) {
        Object.entries(schemaSpec.nodes).forEach(([name, spec]) => {
          builder.addNode(name, spec);
        });
      }
      if (schemaSpec?.marks) {
        Object.entries(schemaSpec.marks).forEach(([name, spec]) => {
          builder.addMark(name, spec);
        });
      }
    });

    schema = builder.build();
  });

  describe('Basic parsing', () => {
    it('should parse empty string', () => {
      const doc = parseMarkdown('', schema);
      expect(doc).toBeDefined();
      expect(doc.childCount).toBe(1);
    });

    it('should parse simple paragraph', () => {
      const doc = parseMarkdown('Hello world', schema);
      expect(doc.childCount).toBe(1);
      expect(doc.firstChild?.type.name).toBe('paragraph');
    });

    it('should parse multiple paragraphs', () => {
      const markdown = 'First paragraph\n\nSecond paragraph';
      const doc = parseMarkdown(markdown, schema);
      expect(doc.childCount).toBe(2);
    });
  });

  describe('Inline formatting', () => {
    it('should parse bold text', () => {
      const doc = parseMarkdown('**bold**', schema);
      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.some((m) => m.type.name === 'bold')).toBe(true);
    });

    it('should parse italic text', () => {
      const doc = parseMarkdown('*italic*', schema);
      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.some((m) => m.type.name === 'italic')).toBe(true);
    });

    it('should parse inline code', () => {
      const doc = parseMarkdown('`code`', schema);
      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.some((m) => m.type.name === 'code')).toBe(true);
    });

    it('should parse strikethrough (GFM)', () => {
      const doc = parseMarkdown('~~strike~~', schema);
      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.some((m) => m.type.name === 'strike')).toBe(true);
    });

    it('should parse combined formatting', () => {
      const doc = parseMarkdown('***bold italic***', schema);
      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.some((m) => m.type.name === 'bold')).toBe(true);
      expect(textNode?.marks.some((m) => m.type.name === 'italic')).toBe(true);
    });
  });

  describe('Headings', () => {
    it('should parse h1', () => {
      const doc = parseMarkdown('# Heading 1', schema);
      expect(doc.firstChild?.type.name).toBe('heading');
      expect(doc.firstChild?.attrs.level).toBe(1);
    });

    it('should parse h2', () => {
      const doc = parseMarkdown('## Heading 2', schema);
      expect(doc.firstChild?.type.name).toBe('heading');
      expect(doc.firstChild?.attrs.level).toBe(2);
    });

    it('should parse h3', () => {
      const doc = parseMarkdown('### Heading 3', schema);
      expect(doc.firstChild?.type.name).toBe('heading');
      expect(doc.firstChild?.attrs.level).toBe(3);
    });

    it('should parse h6', () => {
      const doc = parseMarkdown('###### Heading 6', schema);
      expect(doc.firstChild?.type.name).toBe('heading');
      expect(doc.firstChild?.attrs.level).toBe(6);
    });
  });

  describe('Lists', () => {
    it('should parse bullet list', () => {
      const markdown = '- Item 1\n- Item 2';
      const doc = parseMarkdown(markdown, schema);
      expect(doc.firstChild?.type.name).toBe('bullet_list');
      expect(doc.firstChild?.childCount).toBe(2);
    });

    it('should parse ordered list', () => {
      const markdown = '1. Item 1\n2. Item 2';
      const doc = parseMarkdown(markdown, schema);
      expect(doc.firstChild?.type.name).toBe('ordered_list');
      expect(doc.firstChild?.childCount).toBe(2);
    });

    it('should parse nested lists', () => {
      const markdown = '- Item 1\n  - Nested item';
      const doc = parseMarkdown(markdown, schema);
      expect(doc.firstChild?.type.name).toBe('bullet_list');
    });
  });

  describe('Blockquotes', () => {
    it('should parse blockquote', () => {
      const markdown = '> Quote';
      const doc = parseMarkdown(markdown, schema);
      expect(doc.firstChild?.type.name).toBe('blockquote');
    });

    it('should parse multi-line blockquote', () => {
      const markdown = '> Line 1\n> Line 2';
      const doc = parseMarkdown(markdown, schema);
      expect(doc.firstChild?.type.name).toBe('blockquote');
    });
  });

  describe('Code blocks', () => {
    it('should parse code block', () => {
      const markdown = '```\ncode\n```';
      const doc = parseMarkdown(markdown, schema);
      expect(doc.firstChild?.type.name).toBe('code_block');
    });

    it('should parse code block with language', () => {
      const markdown = '```javascript\nconst x = 1;\n```';
      const doc = parseMarkdown(markdown, schema);
      expect(doc.firstChild?.type.name).toBe('code_block');
      expect(doc.firstChild?.attrs.language).toBe('javascript');
    });
  });

  describe('Links', () => {
    it('should parse link', () => {
      const markdown = '[text](http://example.com)';
      const doc = parseMarkdown(markdown, schema);
      const textNode = doc.firstChild?.firstChild;
      const linkMark = textNode?.marks.find((m) => m.type.name === 'link');
      expect(linkMark).toBeDefined();
      expect(linkMark?.attrs.href).toBe('http://example.com');
    });

    it('should parse link with title', () => {
      const markdown = '[text](http://example.com "title")';
      const doc = parseMarkdown(markdown, schema);
      const textNode = doc.firstChild?.firstChild;
      const linkMark = textNode?.marks.find((m) => m.type.name === 'link');
      expect(linkMark?.attrs.title).toBe('title');
    });
  });

  describe('Horizontal rule', () => {
    it('should parse horizontal rule', () => {
      const markdown = '---';
      const doc = parseMarkdown(markdown, schema);
      expect(doc.firstChild?.type.name).toBe('horizontal_rule');
    });

    it('should parse *** as horizontal rule', () => {
      const markdown = '***';
      const doc = parseMarkdown(markdown, schema);
      expect(doc.firstChild?.type.name).toBe('horizontal_rule');
    });
  });
});

describe('Markdown Serializer', () => {
  let schema: Schema;

  beforeEach(() => {
    const builder = new SchemaBuilder();

    const extensions = [
      new BoldExtension(),
      new ItalicExtension(),
      new CodeExtension(),
      new StrikeExtension(),
      new HeadingExtension(),
      new ParagraphExtension(),
      new BlockquoteExtension(),
      new HorizontalRuleExtension(),
      new BulletListExtension(),
      new OrderedListExtension(),
      new ListItemExtension(),
      new CodeBlockExtension(),
      new LinkExtension(),
    ];

    extensions.forEach((ext) => {
      const schemaSpec = ext.getSchema();
      if (schemaSpec?.nodes) {
        Object.entries(schemaSpec.nodes).forEach(([name, spec]) => {
          builder.addNode(name, spec);
        });
      }
      if (schemaSpec?.marks) {
        Object.entries(schemaSpec.marks).forEach(([name, spec]) => {
          builder.addMark(name, spec);
        });
      }
    });

    schema = builder.build();
  });

  describe('Basic serialization', () => {
    it('should serialize empty document', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph')]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toBe('');
    });

    it('should serialize paragraph', () => {
      const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Hello world')])]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toBe('Hello world');
    });

    it('should serialize multiple paragraphs', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('First')]),
        schema.node('paragraph', null, [schema.text('Second')]),
      ]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toContain('First');
      expect(markdown).toContain('Second');
    });
  });

  describe('Inline formatting', () => {
    it('should serialize bold text', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('bold', [schema.marks.bold.create()])]),
      ]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toBe('**bold**');
    });

    it('should serialize italic text', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('italic', [schema.marks.italic.create()])]),
      ]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toBe('*italic*');
    });

    it('should serialize inline code', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('code', [schema.marks.code.create()])]),
      ]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toBe('`code`');
    });

    it('should serialize strikethrough', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('strike', [schema.marks.strike.create()])]),
      ]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toBe('~~strike~~');
    });
  });

  describe('Headings', () => {
    it('should serialize h1', () => {
      const doc = schema.node('doc', null, [schema.node('heading', { level: 1 }, [schema.text('Title')])]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toBe('# Title');
    });

    it('should serialize h2', () => {
      const doc = schema.node('doc', null, [schema.node('heading', { level: 2 }, [schema.text('Title')])]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toBe('## Title');
    });

    it('should serialize h6', () => {
      const doc = schema.node('doc', null, [schema.node('heading', { level: 6 }, [schema.text('Title')])]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toBe('###### Title');
    });
  });

  describe('Lists', () => {
    it('should serialize bullet list', () => {
      const doc = schema.node('doc', null, [
        schema.node('bullet_list', null, [
          schema.node('list_item', null, [schema.node('paragraph', null, [schema.text('Item')])]),
        ]),
      ]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toContain('- Item');
    });

    it('should serialize ordered list', () => {
      const doc = schema.node('doc', null, [
        schema.node('ordered_list', null, [
          schema.node('list_item', null, [schema.node('paragraph', null, [schema.text('Item')])]),
        ]),
      ]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toContain('1. Item');
    });
  });

  describe('Blockquotes', () => {
    it('should serialize blockquote', () => {
      const doc = schema.node('doc', null, [
        schema.node('blockquote', null, [schema.node('paragraph', null, [schema.text('Quote')])]),
      ]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toContain('> Quote');
    });
  });

  describe('Code blocks', () => {
    it('should serialize code block', () => {
      const doc = schema.node('doc', null, [schema.node('code_block', null, [schema.text('code')])]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toContain('```');
      expect(markdown).toContain('code');
    });

    it('should serialize code block with language', () => {
      const doc = schema.node('doc', null, [
        schema.node('code_block', { language: 'javascript' }, [schema.text('const x = 1;')]),
      ]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toContain('```javascript');
      expect(markdown).toContain('const x = 1;');
    });
  });

  describe('Links', () => {
    it('should serialize link', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('link', [schema.marks.link.create({ href: 'http://example.com' })]),
        ]),
      ]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toBe('[link](http://example.com)');
    });

    it('should serialize link with title', () => {
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('link', [schema.marks.link.create({ href: 'http://example.com', title: 'Title' })]),
        ]),
      ]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toContain('"Title"');
    });
  });

  describe('Horizontal rule', () => {
    it('should serialize horizontal rule', () => {
      const doc = schema.node('doc', null, [schema.nodes.horizontal_rule.create()]);
      const markdown = serializeToMarkdown(doc);
      expect(markdown).toBe('---');
    });
  });

  describe('Round-trip conversion', () => {
    it('should preserve content through parse->serialize cycle', () => {
      const original = '# Title\n\nThis is **bold** and *italic* text.';
      const doc = parseMarkdown(original, schema);
      const markdown = serializeToMarkdown(doc);

      // The markdown should be semantically equivalent
      expect(markdown).toContain('# Title');
      expect(markdown).toContain('**bold**');
      expect(markdown).toContain('*italic*');
    });

    it('should preserve lists through round-trip', () => {
      const original = '- Item 1\n- Item 2\n- Item 3';
      const doc = parseMarkdown(original, schema);
      const markdown = serializeToMarkdown(doc);

      expect(markdown).toContain('- Item 1');
      expect(markdown).toContain('- Item 2');
      expect(markdown).toContain('- Item 3');
    });
  });
});
