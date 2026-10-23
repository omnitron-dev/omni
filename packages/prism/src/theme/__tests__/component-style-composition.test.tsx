import { render, fireEvent } from '@testing-library/react';
import { ThemeProvider, type ThemeOptions } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import { describe, expect, it } from 'vitest';
import { Accordion as AccordionGroup, SimpleAccordion } from '../../components/accordion/accordion.js';
import { createPrismTheme } from '../create-theme.js';

function sample(overrides?: Partial<ThemeOptions>) {
  return (
    <ThemeProvider theme={createPrismTheme({ density: 'compact', overrides })}>
      <Accordion>
        <AccordionSummary expandIcon={<svg width="20" height="20" aria-hidden="true" />}>
          A source-bound research document
        </AccordionSummary>
        <AccordionDetails>Exact revision and evidence.</AccordionDetails>
      </Accordion>
    </ThemeProvider>
  );
}
function styles(container: HTMLElement, selector: string) {
  const element = container.querySelector<HTMLElement>(selector)!;
  expect(element).not.toBeNull();
  return getComputedStyle(element);
}
describe('component style composition at the rendered MUI boundary', () => {
  it('keeps layout-owned spacing stable in both disclosure states', () => {
    const { container } = render(
      <ThemeProvider theme={createPrismTheme()}>
        <Box data-testid="disclosure-section" sx={{ my: '36px' }}>
          <Accordion>
            <AccordionSummary>Document history</AccordionSummary>
            <AccordionDetails>Saved editions</AccordionDetails>
          </Accordion>
        </Box>
      </ThemeProvider>
    );
    // MUI intentionally resets the expanded first/last Accordion margins.
    // External document spacing belongs to its layout container.
    const accordion = container.querySelector<HTMLElement>('[data-testid="disclosure-section"]')!;
    const button = container.querySelector('button')!;
    const before = getComputedStyle(accordion).marginTop;
    expect(before).toBe('36px');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(getComputedStyle(accordion).marginTop).toBe(before);
    expect(getComputedStyle(accordion).marginBottom).toBe('36px');
    fireEvent.click(button);
    expect(getComputedStyle(accordion).marginTop).toBe(before);
  });

  it('retains compact geometry and borders when an application overrides only colors', () => {
    const { container, rerender } = render(sample());
    const summary = styles(container, '.MuiAccordionSummary-root');
    const baseline = { height: summary.minHeight, padding: summary.padding };
    const border = styles(container, '.MuiAccordion-root').borderTopWidth;
    expect(parseFloat(baseline.height)).toBeGreaterThan(0);
    expect(parseFloat(border)).toBeGreaterThan(0);
    rerender(
      sample({
        components: {
          MuiAccordionSummary: { styleOverrides: { root: { color: 'rgb(1, 2, 3)' } } },
          MuiAccordion: { styleOverrides: { root: { backgroundColor: 'rgb(4, 5, 6)' } } },
        },
      })
    );
    const after = styles(container, '.MuiAccordionSummary-root');
    expect(after.minHeight).toBe(baseline.height);
    expect(after.padding).toBe(baseline.padding);
    expect(after.color).toBe('rgb(1, 2, 3)');
    expect(styles(container, '.MuiAccordion-root').borderTopWidth).toBe(border);
  });
  it('evaluates consumer callbacks and arrays while preserving base expanded geometry', () => {
    const { container, rerender } = render(sample());
    fireEvent.click(container.querySelector('button')!);
    const baseline = styles(container, '.MuiAccordionSummary-root').minHeight;
    rerender(
      sample({
        components: {
          MuiAccordionSummary: {
            styleOverrides: {
              root: [({ theme }) => ({ color: theme.palette.error.main }), { '&.Mui-expanded': { opacity: 0.7 } }],
            },
          },
        },
      })
    );
    const after = styles(container, '.MuiAccordionSummary-root');
    expect(after.minHeight).toBe(baseline);
    expect(after.opacity).toBe('0.7');
    expect(after.color).toBeTruthy();
    expect(styles(container, '.MuiAccordionSummary-content').alignItems).toBe('center');
    expect(styles(container, '.MuiAccordionSummary-expandIconWrapper').flexShrink).toBe('0');
  });
});


describe('table surface in each color mode', () => {
  it.each(['light', 'dark'] as const)('keeps the %s header on the configured semantic surface', (mode) => {
    const paper = mode === 'dark' ? 'rgb(21, 27, 33)' : 'rgb(243, 247, 249)';
    const { container } = render(
      <ThemeProvider theme={createPrismTheme({ mode, cssVariables: { enabled: false }, overrides: { palette: { background: { paper, neutral: paper } } } })}>
        <Table><TableHead><TableRow><TableCell>Statement and scope</TableCell></TableRow></TableHead></Table>
      </ThemeProvider>
    );
    expect(styles(container, 'th').backgroundColor).toBe(paper);
  });
});


describe('disclosure outlines are independent of neighboring content', () => {
  it.each(['light', 'dark'] as const)('retains every %s outline before trailing content, nested controls and expanded content', (mode) => {
    const { container } = render(
      <ThemeProvider theme={createPrismTheme({ mode, cssVariables: { enabled: false } })}>
        <Box>
          <Accordion sx={{ my: 2 }}><AccordionSummary>Impact and review</AccordionSummary><AccordionDetails>Dependencies</AccordionDetails></Accordion>
          <p>A following paragraph is not another panel.</p>
          <SimpleAccordion title="Corpus access">Roles and permissions</SimpleAccordion>
          <button type="button">Save</button>
          <AccordionGroup variant="outlined" items={[
            { id: 'source', title: 'Source history', content: 'Historical source' },
            { id: 'proof', title: 'Proof history', content: 'Recorded judgment' },
          ]} />
          <p>Publication actions</p>
        </Box>
      </ThemeProvider>
    );
    const panels = [...container.querySelectorAll<HTMLElement>('.MuiAccordion-root')];
    expect(panels.length).toBe(4);
    const outline = () => panels.forEach(panel => {
      const style = getComputedStyle(panel);
      expect(style.borderBottomWidth).toBe('1px');
      expect(style.borderBottomStyle).toBe('solid');
    });
    outline();
    for (const panel of panels) {
      const summary = panel.querySelector<HTMLButtonElement>('.MuiAccordionSummary-root')!;
      fireEvent.click(summary);
      expect(summary.getAttribute('aria-expanded')).toBe('true');
      outline();
      fireEvent.click(summary);
      outline();
    }
  });
});
