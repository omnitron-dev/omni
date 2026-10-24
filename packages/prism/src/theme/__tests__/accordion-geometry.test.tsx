import { render, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import { describe, expect, it, vi } from 'vitest';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { SimpleAccordion } from '../../components/accordion/accordion.js';
import { createPrismTheme } from '../create-theme.js';

describe('independent disclosure geometry and SSR-safe styling', () => {
  it.each(['light', 'dark'] as const)(
    'preserves all %s corners, native square and full outlines with mixed siblings',
    (mode) => {
      const { container } = render(
        <ThemeProvider theme={createPrismTheme({ mode, borderRadius: 10 })}>
          <Box>
            <p>Leading context</p>
            <Accordion>
              <AccordionSummary>First</AccordionSummary>
              <AccordionDetails>Details</AccordionDetails>
            </Accordion>
            <style data-emotion="server-inserted">{'.server-inserted { display: block; }'}</style>
            <Accordion>
              <AccordionSummary>Middle</AccordionSummary>
              <AccordionDetails>Details</AccordionDetails>
            </Accordion>
            <hr />
            <Accordion square>
              <AccordionSummary>Square</AccordionSummary>
              <AccordionDetails>Details</AccordionDetails>
            </Accordion>
            <SimpleAccordion title="Last">Details</SimpleAccordion>
            <p>Trailing context</p>
          </Box>
        </ThemeProvider>
      );
      const panels = [...container.querySelectorAll<HTMLElement>('.MuiAccordion-root')];
      expect(panels).toHaveLength(4);
      const verifyGeometry = () =>
        panels.forEach((panel, index) => {
          const style = getComputedStyle(panel);
          for (const edge of ['Top', 'Right', 'Bottom', 'Left']) {
            expect(style.getPropertyValue(`border-${edge.toLowerCase()}-width`)).toBe('1px');
            expect(style.getPropertyValue(`border-${edge.toLowerCase()}-style`)).toBe('solid');
          }
          for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
            expect(style.getPropertyValue(`border-${corner}-radius`)).toBe(index === 2 ? '0px' : '10px');
          }
        });
      verifyGeometry();
      for (const panel of panels) {
        const summary = panel.querySelector<HTMLButtonElement>('.MuiAccordionSummary-root')!;
        fireEvent.click(summary);
        expect(summary).toHaveAttribute('aria-expanded', 'true');
        verifyGeometry();
        fireEvent.click(summary);
        verifyGeometry();
      }
    }
  );

  it('emits no Emotion SSR-unsafe positional-selector warning when native MUI panels render', () => {
    // A fresh cache must compile the styles even if another test already rendered
    // an Accordion. Keep console output live; this assertion is not suppression.
    const errors = vi.spyOn(console, 'error');
    const cache = createCache({ key: 'disclosure-ssr-regression' });
    try {
      render(
        <CacheProvider value={cache}>
          <ThemeProvider theme={createPrismTheme()}>
            <Accordion>
              <AccordionSummary>Source</AccordionSummary>
              <AccordionDetails>Evidence</AccordionDetails>
            </Accordion>
            <p>Publication controls</p>
          </ThemeProvider>
        </CacheProvider>
      );
      expect(errors.mock.calls.flat().join('\n')).not.toMatch(/potentially unsafe when doing server-side rendering/);
    } finally {
      errors.mockRestore();
      cache.sheet.flush();
    }
  });
});
