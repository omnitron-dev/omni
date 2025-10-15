import { gapCursor } from 'prosemirror-gapcursor';
import type { Plugin } from 'prosemirror-state';
import { Extension } from '../../core/Extension.js';

export class GapCursorExtension extends Extension {
  readonly name = 'gap_cursor';
  readonly type = 'behavior' as const;

  override getPlugins(): Plugin[] {
    return [gapCursor()];
  }
}
