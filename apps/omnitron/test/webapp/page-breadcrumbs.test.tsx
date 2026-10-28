// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Breadcrumbs } from '../../webapp/src/components/page-breadcrumbs.js';

afterEach(cleanup);

function Location() {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

describe('Console page navigation', () => {
  it('keeps titles accessible and navigates within the mounted application', () => {
    render(
      <MemoryRouter initialEntries={['/nodes/edge']}>
        <Breadcrumbs
          heading="Edge node"
          links={[{ name: 'Nodes', href: '/nodes' }, { name: 'Edge node' }]}
          action={<button>Inspect</button>}
        />
        <Location />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Edge node');
    expect(document.title).toBe('Edge node · Omnitron');
    expect(screen.getByRole('button', { name: 'Inspect' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Nodes' }));
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/nodes');
    fireEvent.click(screen.getByRole('link', { name: 'Console' }));
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/');
  });

  it('does not let a mounted inactive workspace replace the current page title', () => {
    const { rerender } = render(
      <MemoryRouter>
        <Breadcrumbs heading="Audit" />
      </MemoryRouter>
    );
    rerender(
      <MemoryRouter>
        <Breadcrumbs heading="SSH workspace" active={false} />
      </MemoryRouter>
    );
    expect(document.title).toBe('Audit · Omnitron');
    rerender(
      <MemoryRouter>
        <Breadcrumbs heading="SSH workspace" />
      </MemoryRouter>
    );
    expect(document.title).toBe('SSH workspace · Omnitron');
  });
});
