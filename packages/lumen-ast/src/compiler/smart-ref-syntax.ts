import type { Extension, Options } from 'mdast-util-from-markdown';
import type { Options as MarkdownOptions } from 'mdast-util-to-markdown';
import type { Position } from '../ast/types.js';
import { SMART_REF_PATTERN } from './smart-refs.js';

interface SmartReference {
  type: 'lumenSmartReference';
  value: string;
  position?: Position;
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    lumenSmartReference: 'lumenSmartReference';
  }
}
declare module 'mdast' {
  interface PhrasingContentMap {
    lumenSmartReference: SmartReference;
  }
  interface RootContentMap {
    lumenSmartReference: SmartReference;
  }
}

type Syntax = NonNullable<Options['extensions']>[number];
type Construct = Extract<NonNullable<Syntax['text']>[number], { tokenize: unknown }>;
type State = ReturnType<Construct['tokenize']>;
const reference = new RegExp(`^${SMART_REF_PATTERN.source}`);

/** A native inline construct keeps escapes, code, URLs, entities and exact
 * token positions under the Markdown grammar instead of rewriting raw text. */
export function smartReferenceSyntax(): Syntax {
  return {
    text: {
      64: {
        tokenize(effects, ok, nok) {
          let length = 0;
          const probe: Construct = {
            partial: true,
            tokenize(scan, yes, no) {
              let value = '',
                target = false;
              const finish: State = (code) => {
                const character = code === null ? '' : String.fromCharCode(code);
                const suffix = code === null ? '' : code < 0 || /[\]*`<)]/.test(character) ? '\n' : character;
                const match = reference.exec(value + suffix);
                length = match?.[0].length ?? 0;
                scan.exit('lumenSmartReference');
                return length ? yes(code) : no(code);
              };
              const consume: State = (code) => {
                if (code === null || code < 0 || /\s/.test(String.fromCharCode(code))) return finish(code);
                const char = String.fromCharCode(code);
                if (!value) {
                  if (char !== '@') return no(code);
                  scan.enter('lumenSmartReference');
                } else if (!target) {
                  if (value.length === 1 && !/[a-zA-Z]/.test(char)) return no(code);
                  if (char === ':') target = true;
                  else if (!/[\w-]/.test(char)) return no(code);
                } else if (!/[a-zA-Z0-9_./#~-]/.test(char) && !(char === '@' && value.endsWith(':'))) {
                  if (/[\]*`<)]/.test(char)) return finish(code);
                  if (!/[,.:;!?"'()[\]{}]/.test(char)) return no(code);
                  value += char;
                  scan.consume(code);
                  return finish;
                }
                value += char;
                scan.consume(code);
                return consume;
              };
              return consume;
            },
          };
          const consume: State = (code) => {
            if (length === 0) {
              effects.exit('lumenSmartReference');
              return ok(code);
            }
            if (code === null) return nok(code);
            effects.consume(code);
            length--;
            return consume;
          };
          const start: State = (code) => {
            effects.enter('lumenSmartReference');
            return consume(code);
          };
          return effects.check(probe, start, nok);
        },
      },
    },
  };
}

export function smartReferenceFromMarkdown(): Extension {
  return {
    enter: {
      lumenSmartReference(token) {
        this.enter({ type: 'lumenSmartReference', value: this.sliceSerialize(token) }, token);
      },
    },
    exit: {
      lumenSmartReference(token) {
        this.exit(token);
      },
    },
  };
}

export function smartReferenceToMarkdown(): NonNullable<MarkdownOptions['extensions']>[number] {
  return {
    handlers: {
      lumenSmartReference(node) {
        const match = reference.exec(node.value);
        if (match?.[0] !== node.value) throw new TypeError('Invalid smart reference for Markdown export');
        return node.value;
      },
    },
  };
}
