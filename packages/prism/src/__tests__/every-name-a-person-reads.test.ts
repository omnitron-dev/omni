/**
 * Every name a person reads, in every component that offers a dictionary.
 *
 * The editor's names were written into its components — `aria-label="Bold"`,
 * `label="Link URL"`, a `<Typography>` reading `Add image` — which on a
 * Russian-first product put English beside Russian field labels on every
 * content form. An `aria-label` is also the ONLY text a screen reader gets
 * for an icon button, so the gap was in the accessibility tree as well.
 *
 * The lightbox had the same eight: Zoom in, Zoom out, Download, Share, Close,
 * Previous, Next — and it is where a person looks at a photograph sent to
 * them in chat, an image in a shop review, a picture in the documentation.
 *
 * Both now take a `labels` prop whose defaults are the previous English
 * verbatim. This is the rule they both answer to, in one place rather than
 * one copy per component:
 *
 *   1. no visible string is written into a component;
 *   2. every label the dictionary declares is read by one;
 *   3. every `labels.x` a component reads is declared.
 *
 * The first `it` is what keeps the rule from rotting: the registry below has
 * to name EVERY `DEFAULT_*_LABELS` in the package, so a third dictionary
 * turns this file red until someone adds it, instead of quietly going
 * unchecked. That is the failure the editor's own first pass had — it swept
 * for `aria-label` and so found only what already had one.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { DEFAULT_EDITOR_LABELS } from '../components/editor/types.js';
import { DEFAULT_LIGHTBOX_LABELS } from '../components/lightbox/types.js';
import { DEFAULT_SPONSORED_SLOT_LABELS } from '../components/sponsored-slot/types.js';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Component directory → the dictionary its `labels` prop merges over. */
const REGISTRY: Record<string, Record<string, string>> = {
  'components/editor': DEFAULT_EDITOR_LABELS,
  // Spread: `LightboxLabels` is an interface, and an interface has no implicit
  // index signature — the literal copy has the same seven strings and does.
  'components/lightbox': { ...DEFAULT_LIGHTBOX_LABELS },
  'components/sponsored-slot': { ...DEFAULT_SPONSORED_SLOT_LABELS },
};

/**
 * A URL scheme is not a word in any language — it is what the field expects
 * typed into it, and it reads the same in every locale. Nothing else belongs
 * here: the list exists so that adding to it is a decision someone makes on
 * purpose, in a diff.
 */
const NOT_A_WORD = new Set(['https://']);

function walk(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full, match);
    return e.isFile() && match(e.name) ? [full] : [];
  });
}

const sources = (dir: string) =>
  new Map(
    walk(path.join(src, dir), (n) => n.endsWith('.tsx') && !n.endsWith('.test.tsx')).map((f) => [
      path.relative(src, f),
      readFileSync(f, 'utf8'),
    ])
  );

describe('every name a person reads', () => {
  it('checks every dictionary the package declares', () => {
    const declared = walk(src, (n) => n.endsWith('.ts') || n.endsWith('.tsx'))
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/export const (DEFAULT_[A-Z_]+_LABELS)\b/g)].map(
          (m) => `${path.dirname(path.relative(src, f))}:${m[1]}`
        )
      );

    // Named by directory, so a dictionary that moves is noticed too.
    expect(declared.map((d) => d.split(':')[0]).sort()).toEqual(Object.keys(REGISTRY).sort());
  });

  for (const [dir, labels] of Object.entries(REGISTRY)) {
    describe(dir, () => {
      const files = sources(dir);

      it('has components to check', () => {
        // Before asserting a property of a possibly empty set.
        expect(files.size).toBeGreaterThan(0);
      });

      it('writes no visible string into a component', () => {
        const attribute = /\b(?:aria-label|label|placeholder|title)="([^"]+)"/g;
        const offences: string[] = [];

        for (const [file, text] of files) {
          for (const [, value] of text.matchAll(attribute)) {
            if (!NOT_A_WORD.has(value!)) offences.push(`${file}: ${value}`);
          }
          // A bare word between JSX tags — `<Typography>Add image</Typography>`,
          // `<Button>Apply</Button>`. Anything interpolated is `{…}` and does
          // not match, which is the whole point.
          for (const [, value] of text.matchAll(/>\s*([A-Za-z][A-Za-z ]{2,})\s*</g)) {
            offences.push(`${file}: ${value!.trim()}`);
          }
        }

        expect(offences).toEqual([]);
      });

      it('is read for every label it declares', () => {
        const all = [...files.values()].join('\n');
        expect(Object.keys(labels).filter((key) => !all.includes(`labels.${key}`))).toEqual([]);
      });

      it('declares every label it reads', () => {
        const declared = new Set(Object.keys(labels));
        const read = [
          ...[...files.values()].join('\n').matchAll(/\blabels\.([A-Za-z]+)/g),
        ].map((m) => m[1]!);
        expect([...new Set(read)].filter((key) => !declared.has(key))).toEqual([]);
      });
    });
  }
});
