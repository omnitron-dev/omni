/**
 * Every name the editor shows a person.
 *
 * The toolbar's names were written into the components: `aria-label="Bold"`,
 * `label="Link URL"`, a `<Typography>` reading `Add image`, two buttons
 * reading `Apply`. On a Russian-first product that put English beside Russian
 * field labels on every content form — a post, a community description, an
 * organisation profile, a shop, a lesson, a chat message — and, because an
 * `aria-label` is the ONLY text a screen reader gets for an icon button, the
 * gap was in the accessibility tree and not only in the tooltip.
 *
 * `EditorLabels` + `DEFAULT_EDITOR_LABELS` moved them to a prop whose default
 * is the previous English verbatim, so a consumer that passes nothing is
 * unchanged. The first sweep took the 25 `aria-label`s and stopped there,
 * which is the shape of the mistake worth a check: an `aria-label` sweep
 * finds what HAS an `aria-label`, and the two popovers carry visible text
 * that never did — a field label, a heading, and the button you press.
 *
 * So this asserts the rule rather than the sweep:
 *
 *   1. no visible string is written into a component;
 *   2. every label the type declares is actually read by one;
 *   3. every `labels.x` a component reads is declared.
 *
 * (2) and (3) are the halves that rot in opposite directions — a declared
 * label nothing reads is a translation a translator writes for nothing, and
 * a read of an undeclared one would not compile today but would survive a
 * later rename of the type.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { DEFAULT_EDITOR_LABELS } from './types.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Every `.tsx` under the editor — the components a person sees. */
function components(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return components(full);
    return e.isFile() && e.name.endsWith('.tsx') ? [full] : [];
  });
}

const files = components(here);

const source = new Map(files.map((f) => [path.relative(here, f), readFileSync(f, 'utf8')]));

/**
 * A URL scheme is not a word in any language — it is what the field expects
 * typed into it, and it reads the same in every locale. Nothing else belongs
 * here: the list exists so that adding to it is a decision someone makes on
 * purpose, in a diff.
 */
const NOT_A_WORD = new Set(['https://']);

describe('every name the editor shows', () => {
  it('has components to check', () => {
    // Before asserting a property of a possibly empty set.
    expect(files.length).toBeGreaterThan(5);
  });

  it('writes no visible string into a component', () => {
    const attribute = /\b(?:aria-label|label|placeholder|title)="([^"]+)"/g;
    const offences: string[] = [];

    for (const [file, text] of source) {
      for (const [, value] of text.matchAll(attribute)) {
        if (!NOT_A_WORD.has(value!)) offences.push(`${file}: ${value}`);
      }
      // A bare word between JSX tags — `<Typography>Add image</Typography>`,
      // `<Button>Apply</Button>`. Anything interpolated is `{…}` and does not
      // match, which is the whole point.
      for (const [, value] of text.matchAll(/>\s*([A-Za-z][A-Za-z ]{2,})\s*</g)) {
        offences.push(`${file}: ${value!.trim()}`);
      }
    }

    expect(offences).toEqual([]);
  });

  it('is read for every label it declares', () => {
    const all = [...source.values()].join('\n');
    const unread = Object.keys(DEFAULT_EDITOR_LABELS).filter(
      (key) => !all.includes(`labels.${key}`)
    );

    expect(unread).toEqual([]);
  });

  it('declares every label it reads', () => {
    const declared = new Set(Object.keys(DEFAULT_EDITOR_LABELS));
    const read = new Set(
      [...[...source.values()].join('\n').matchAll(/\blabels\.([A-Za-z]+)/g)].map((m) => m[1]!)
    );

    expect([...read].filter((key) => !declared.has(key))).toEqual([]);
  });
});
