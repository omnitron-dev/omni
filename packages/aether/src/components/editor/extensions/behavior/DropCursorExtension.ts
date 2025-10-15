import { dropCursor } from 'prosemirror-dropcursor';
import type { Plugin } from 'prosemirror-state';
import { Extension } from '../../core/Extension.js';

export interface DropCursorOptions {
  color?: string;
  width?: number;
  class?: string;
}

export class DropCursorExtension extends Extension<DropCursorOptions> {
  readonly name = 'drop_cursor';
  readonly type = 'behavior' as const;

  protected override defaultOptions(): DropCursorOptions {
    return {
      color: '#000',
      width: 1,
    };
  }

  override getPlugins(): Plugin[] {
    return [
      dropCursor({
        color: this.options.color,
        width: this.options.width,
        class: this.options.class,
      }),
    ];
  }
}
