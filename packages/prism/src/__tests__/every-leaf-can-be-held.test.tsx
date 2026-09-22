/**
 * Every leaf can be held.
 *
 * A `Tooltip` attaches its ref and its hover handlers to its child. A
 * transition — `Collapse`, `Fade`, `Grow` inside a `Snackbar` — holds its
 * child by ref and animates it through `style`. So a leaf component that does
 * not take `ref` and pass the rest of its props to its root either breaks a
 * transition outright or turns a tooltip into one that never opens.
 *
 * Measured on 2026-09-22: `<Snackbar><Alert>` on the console's Topology page
 * threw from MUI's `reflow` — «Cannot read properties of null (reading
 * 'scrollTop')» — on every failed fetch, taking the page down; and two
 * `<Tooltip><StatusChip>` in the portal never opened. (`Collapse` is not in
 * that list: it measures a wrapper of its own, so a leaf without a ref
 * survives it — `Grow`, `Fade`, `Zoom` and `Slide` hold the child itself.)
 *
 * The library's convention — take `ref`, spread the rest on the root — was
 * already the rule for `Card`, `Avatar`, `Label`. This court makes it a
 * checked one for the leaves: each renders with a ref and a foreign attribute,
 * and both have to arrive on the same DOM node.
 */

import { createRef, type ReactElement, type Ref } from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import Snackbar from '@mui/material/Snackbar';
import { describe, expect, it } from 'vitest';

import { createPrismTheme } from '../theme/create-theme.js';
import { Alert, InlineAlert, FormAlert } from '../components/alert/alert.js';
import { StatusChip } from '../components/admin-filters/status-chip.js';
import { CountBadge, StatusDot } from '../components/badge/badge.js';
import { Label, StatusLabel, BooleanLabel } from '../components/label/label.js';
import { Skeleton } from '../components/skeleton/skeleton.js';

type Held = { ref: Ref<HTMLElement>; 'data-held': string };

/** Name → how to render it with nothing but what it needs, plus what a holder passes. */
const LEAVES: Array<[string, (held: Held) => ReactElement]> = [
  ['Alert', (h) => <Alert {...(h as never)}>x</Alert>],
  ['InlineAlert', (h) => <InlineAlert message="x" {...(h as never)} />],
  ['FormAlert', (h) => <FormAlert autoScroll={false} {...(h as never)}>x</FormAlert>],
  ['StatusChip', (h) => <StatusChip status="active" {...(h as never)} />],
  ['CountBadge', (h) => <CountBadge count={3} {...(h as never)} />],
  ['StatusDot', (h) => <StatusDot status="online" {...(h as never)} />],
  ['Label', (h) => <Label {...(h as never)}>x</Label>],
  ['StatusLabel', (h) => <StatusLabel status="active" {...(h as never)} />],
  ['BooleanLabel', (h) => <BooleanLabel value {...(h as never)} />],
  ['Skeleton', (h) => <Skeleton {...(h as never)} />],
];

function themed(node: ReactElement) {
  return render(<ThemeProvider theme={createPrismTheme()}>{node}</ThemeProvider>);
}

describe('every leaf a Tooltip or a transition may hold', () => {
  for (const [name, make] of LEAVES) {
    it(`${name} gives its ref and its props to one DOM node`, () => {
      const ref = createRef<HTMLElement>();
      const { container } = themed(make({ ref, 'data-held': name }));
      const marked = container.querySelector(`[data-held="${name}"]`);
      expect(ref.current, `${name} did not attach the ref`).toBeInstanceOf(HTMLElement);
      expect(marked, `${name} dropped a prop its holder passed`).not.toBeNull();
      expect(ref.current).toBe(marked);
    });
  }

  it('an Alert inside an open Snackbar mounts — the crash that took Topology down', () => {
    expect(() =>
      themed(
        <Snackbar open anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
          <Alert severity="error">topology could not be read</Alert>
        </Snackbar>,
      ),
    ).not.toThrow();
  });
});
