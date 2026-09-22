/**
 * A wrapped row that kept its margin.
 *
 * MUI's `Stack` spaces children with margins by default: every child but the
 * first gets a margin on the spacing side, and every child's own margin is
 * reset to 0. When a row WRAPS, the first item of each wrapped line keeps its
 * margin while the first item of the first line has none — so the first line
 * sits one gap to the left of the rest. Seen in the release console's gate
 * strip on 2026-09-22, and the same shape (a wrapping `Stack` with `spacing`)
 * was measured in 146 places across the console, prism and the portal.
 *
 * The theme now makes `Stack` use CSS `gap`. This court holds that decision
 * where it lives — in the stylesheet a themed `Stack` actually produces, not
 * in the config object alone, because a default the component ignores would
 * satisfy the second and not the first.
 */

import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import { describe, expect, it } from 'vitest';

import { componentOverrides } from '../components/index.js';
import { createPrismTheme } from '../create-theme.js';

/** Every CSS rule the page holds, as text — emotion writes them into <style> tags. */
function allRules(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) out.push(rule.cssText);
    } catch {
      // A sheet that will not list its rules has nothing of ours in it.
    }
  }
  // happy-dom may not expose rules inserted with `insertRule`; the tags'
  // text is the fallback.
  for (const tag of Array.from(document.querySelectorAll('style'))) out.push(tag.textContent ?? '');
  return out.join('\n');
}

describe('a themed Stack', () => {
  it('declares CSS gap as the default', () => {
    const overrides = componentOverrides({ density: 'standard', borderRadius: 8 } as never) as {
      MuiStack?: { defaultProps?: { useFlexGap?: boolean } };
    };
    expect(overrides.MuiStack?.defaultProps?.useFlexGap).toBe(true);
  });

  it('spaces a wrapping row with gap, and gives no child a margin to keep on the next line', () => {
    const { container } = render(
      <ThemeProvider theme={createPrismTheme()}>
        <Stack data-testid="row" direction="row" spacing={1} sx={{ flexWrap: 'wrap', width: 40 }}>
          {Array.from({ length: 12 }, (_, i) => (
            <Box key={i} sx={{ width: 10, height: 10 }} />
          ))}
        </Stack>
      </ThemeProvider>,
    );
    const row = container.querySelector('[data-testid="row"]')!;
    const classes = Array.from(row.classList).filter((c) => c.startsWith('css-'));
    expect(classes.length).toBeGreaterThan(0);

    const rules = allRules()
      .split('}')
      .filter((r) => classes.some((c) => r.includes(`.${c}`)));
    const text = rules.join('}');

    // The mechanism that wraps correctly — prism's spacing is a CSS variable
    // (`var(--prism-spacing, 8px)`), so the value is not asserted, the
    // mechanism is…
    expect(text).toMatch(/gap:\s*var\(--prism-spacing/);
    // …and not the one that leaves the first line one gap to the left.
    expect(text).not.toMatch(/margin-left/);
    expect(text).not.toMatch(/:not\(style\)\s*~\s*:not\(style\)/);
  });
});
