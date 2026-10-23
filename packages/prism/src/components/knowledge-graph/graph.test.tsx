import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

it('keeps one selection when a relation edge is clicked after selecting an entity', async () => {
  // Supply physical canvas measurements, not a fake graph or event handler.
  // Happy DOM has no layout engine; React Flow and its selection store are real.
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return this.classList.contains('react-flow__node') ? 220 : 1200;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return this.classList.contains('react-flow__node') ? 100 : 600;
    },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private targets = new Set<Element>();
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.targets.add(target);
        queueMicrotask(() => {
          if (this.targets.has(target))
            this.callback(
              [
                {
                  target,
                  contentRect: new DOMRect(
                    0,
                    0,
                    (target as HTMLElement).offsetWidth,
                    (target as HTMLElement).offsetHeight
                  ),
                } as ResizeObserverEntry,
              ],
              this as unknown as ResizeObserver
            );
        });
      }
      unobserve(target: Element) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    }
  );
  const onSelect = vi.fn();
  try {
    const { container } = render(
      <KnowledgeGraph
        onSelect={onSelect}
        data={{
          entities: [
            { id: 'source', kind: 'claim', label: 'Source' },
            { id: 'map', kind: 'map', label: 'Interpretation' },
          ],
          relations: [
            {
              id: 'r',
              kind: 'context',
              label: 'Joint contract',
              inputs: [
                { entity: 'source', role: 'first' },
                { entity: 'source', role: 'second' },
              ],
              outputs: [{ entity: 'map', role: 'owner' }],
            },
          ],
        }}
      />
    );
    await waitFor(() => expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'map Interpretation' }));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Selected object' }).textContent).toContain('Interpretation')
    );
    const interaction = container.querySelector('.react-flow__edge-interaction')!;
    fireEvent.click(interaction);
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Selected object' }).textContent).toContain('Joint contract')
    );
    expect(onSelect.mock.calls.map(([selection]) => selection).filter(Boolean)).toEqual([
      { type: 'entity', id: 'map' },
      { type: 'relation', id: 'r' },
    ]);
    expect(container.querySelectorAll('.react-flow__node.selected')).toHaveLength(1);
    expect(container.querySelector('.react-flow__node.selected')?.textContent).toContain('Joint contract');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Selected object' })).toBeNull());
  } finally {
    cleanup();
    vi.unstubAllGlobals();
    if (width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width);
    else Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
    if (height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
    else Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
  }
});
