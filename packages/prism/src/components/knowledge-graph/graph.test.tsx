import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { KnowledgeGraph } from './graph.js';
describe('knowledge workspace controls', () => {
  it('retains accessible theme controls, filtering and selection in index view', () => {
    render(
      <ThemeProvider theme={createTheme({ shape: { borderRadius: 3 } })}>
        <KnowledgeGraph
          data={{
            entities: [
              { id: 'a', label: 'Alpha', kind: 'claim' },
              { id: 'b', label: 'Beta', kind: 'definition' },
            ],
            relations: [],
          }}
        />
      </ThemeProvider>
    );
    const index = screen.getByRole('button', { name: 'Index' });
    expect(index.className).toContain('MuiButton-root');
    fireEvent.click(index);
    const search = screen.getByRole('searchbox', { name: 'Find an entity or relation' });
    expect(search.closest('.MuiTextField-root')).not.toBeNull();
    fireEvent.change(search, { target: { value: 'Alpha' } });
    const result = screen.getByRole('button', { name: /claim Alpha/ });
    expect(screen.queryByRole('button', { name: /definition Beta/ })).toBeNull();
    fireEvent.click(result);
    expect(result.getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('region', { name: 'Selected object' })).not.toBeNull();
  });
});

it('updates observation badges without changing selection or semantic kind', () => {
  const data = (label: string) => ({
    entities: [{ id: 'a', label: 'Claim', kind: 'claim', badges: [{ label, tone: 'warning' as const }] }],
    relations: [],
  });
  const { rerender } = render(<KnowledgeGraph data={data('Not checked')} />);
  fireEvent.click(screen.getByRole('button', { name: 'Index' }));
  fireEvent.click(screen.getByRole('button', { name: /claim Claim Not checked/ }));
  rerender(<KnowledgeGraph data={data('Premises changed')} />);
  const selected = screen.getByRole('button', { name: /claim Claim Premises changed/ });
  expect(selected.getAttribute('aria-current')).toBe('true');
  expect(screen.queryByText('Not checked')).toBeNull();
  expect(selected.querySelector('.MuiChip-root')).not.toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Premises changed' } });
  expect(screen.getByRole('button', { name: /claim Claim Premises changed/ })).toBeTruthy();
});
