/**
 * Markdown serializer - converts ProseMirror documents to markdown strings
 */

import type { Node as PMNode, Mark } from 'prosemirror-model';

/**
 * Serialize ProseMirror document to markdown string
 */
export function serializeToMarkdown(doc: PMNode): string {
  const state = new MarkdownSerializerState();
  state.renderContent(doc);
  return state.output.trim();
}

/**
 * Markdown serializer state
 */
class MarkdownSerializerState {
  output = '';
  private closed: boolean = false;
  private inTightList: boolean = false;

  /**
   * Render a node's content
   */
  renderContent(parent: PMNode): void {
    parent.forEach((node, _offset, index) => {
      this.render(node, parent, index);
    });
  }

  /**
   * Render a single node
   */
  render(node: PMNode, parent: PMNode, index: number): void {
    const nodeSerializer = serializers[node.type.name];
    if (nodeSerializer) {
      nodeSerializer(this, node, parent, index);
    }
  }

  /**
   * Ensure a newline at the current position
   */
  ensureNewLine(): void {
    if (!this.output.endsWith('\n')) {
      this.output += '\n';
    }
  }

  /**
   * Close the current block
   */
  closeBlock(node: PMNode): void {
    this.closed = true;
    if (node.type.name !== 'list_item') {
      this.output += '\n';
    }
  }

  /**
   * Write text with marks
   */
  text(text: string, marks: readonly Mark[] = []): void {
    let output = text;

    // Apply marks
    const activeMarks = [...marks];
    activeMarks.sort((a, b) => a.type.name.localeCompare(b.type.name));

    for (const mark of activeMarks) {
      const markSerializer = markSerializers[mark.type.name];
      if (markSerializer) {
        output = markSerializer(output, mark);
      }
    }

    this.output += output;
    this.closed = false;
  }

  /**
   * Write a string
   */
  write(text: string): void {
    this.output += text;
    this.closed = false;
  }

  /**
   * Render inline content
   */
  renderInline(parent: PMNode): void {
    const active: Mark[] = [];

    parent.forEach((node, offset) => {
      let marks = node.marks || [];

      // Remove marks that are no longer active
      while (active.length > 0 && !marks.includes(active[active.length - 1])) {
        active.pop();
      }

      // Add new marks
      marks = marks.filter((m) => !active.includes(m));
      marks.forEach((mark) => active.push(mark));

      if (node.isText) {
        this.text(node.text || '', active);
      } else {
        this.render(node, parent, offset);
      }
    });
  }

  /**
   * Wrap content with prefix/suffix
   */
  wrapBlock(delim: string, firstDelim: string | null, node: PMNode, f: () => void): void {
    const old = this.output;
    this.output = '';

    f();

    const content = this.output;
    this.output = old;

    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (i > 0) this.write('\n');
      this.write((i === 0 ? firstDelim || delim : delim) + line);
    });
  }
}

/**
 * Node serializers
 */
const serializers: Record<string, (state: MarkdownSerializerState, node: PMNode, parent: PMNode, index: number) => void> = {
  paragraph(state, node) {
    state.renderInline(node);
    state.closeBlock(node);
  },

  heading(state, node) {
    const level = node.attrs.level || 1;
    state.write('#'.repeat(level) + ' ');
    state.renderInline(node);
    state.closeBlock(node);
  },

  blockquote(state, node) {
    state.wrapBlock('> ', null, node, () => state.renderContent(node));
    state.closeBlock(node);
  },

  code_block(state, node) {
    const language = node.attrs.language || '';
    state.write('```' + language + '\n');
    state.write(node.textContent);
    state.ensureNewLine();
    state.write('```');
    state.closeBlock(node);
  },

  horizontal_rule(state, node) {
    state.write('---');
    state.closeBlock(node);
  },

  hard_break(state, node, parent, index) {
    // Add two spaces at the end of the line for a hard break
    for (let i = index + 1; i < parent.childCount; i++) {
      if (parent.child(i).type.name !== 'hard_break') {
        state.write('  \n');
        return;
      }
    }
  },

  bullet_list(state, node) {
    state.renderContent(node);
  },

  ordered_list(state, node) {
    const start = node.attrs.order || 1;
    node.forEach((child, _offset, index) => {
      state.write(`${start + index}. `);
      if (child.type.name === 'list_item') {
        serializeListItem(state, child, node, index);
      }
    });
  },

  list_item(state, node, parent) {
    if (parent.type.name === 'bullet_list') {
      state.write('- ');
      serializeListItem(state, node, parent, 0);
    }
  },

  task_item(state, node, parent) {
    const checked = node.attrs.checked;
    state.write(checked ? '- [x] ' : '- [ ] ');
    serializeListItem(state, node, parent, 0);
  },

  task_list(state, node) {
    state.renderContent(node);
  },

  table(state, node) {
    const rows: string[][] = [];

    node.forEach((row) => {
      const cells: string[] = [];
      row.forEach((cell) => {
        const cellState = new MarkdownSerializerState();
        cellState.renderInline(cell.firstChild || cell);
        cells.push(cellState.output.trim());
      });
      rows.push(cells);
    });

    // Render table
    if (rows.length > 0) {
      // Header
      state.write('| ' + rows[0].join(' | ') + ' |\n');

      // Separator
      state.write('| ' + rows[0].map(() => '---').join(' | ') + ' |\n');

      // Body
      for (let i = 1; i < rows.length; i++) {
        state.write('| ' + rows[i].join(' | ') + ' |\n');
      }
    }

    state.closeBlock(node);
  },

  table_row() {
    // Handled by table serializer
  },

  table_cell() {
    // Handled by table serializer
  },

  table_header() {
    // Handled by table serializer
  },

  image(state, node) {
    const alt = node.attrs.alt || '';
    const src = node.attrs.src || '';
    const title = node.attrs.title;
    state.write('![' + alt + '](' + src + (title ? ' "' + title + '"' : '') + ')');
  },
};

/**
 * Mark serializers
 */
const markSerializers: Record<string, (text: string, mark: Mark) => string> = {
  bold(text) {
    return '**' + text + '**';
  },

  italic(text) {
    return '*' + text + '*';
  },

  code(text) {
    return '`' + text + '`';
  },

  strike(text) {
    return '~~' + text + '~~';
  },

  underline(text) {
    // Markdown doesn't have native underline, use HTML
    return '<u>' + text + '</u>';
  },

  link(text, mark) {
    const href = mark.attrs.href || '';
    const title = mark.attrs.title;
    return '[' + text + '](' + href + (title ? ' "' + title + '"' : '') + ')';
  },
};

/**
 * Serialize list item content
 */
function serializeListItem(state: MarkdownSerializerState, node: PMNode, parent: PMNode, index: number): void {
  if (node.childCount === 0) {
    state.write('\n');
    return;
  }

  // First child
  const first = node.firstChild!;
  if (first.type.name === 'paragraph') {
    state.renderInline(first);
  } else {
    state.render(first, node, 0);
  }

  // Remaining children (nested lists)
  for (let i = 1; i < node.childCount; i++) {
    const child = node.child(i);
    state.write('\n  ');
    state.render(child, node, i);
  }

  state.write('\n');
}
