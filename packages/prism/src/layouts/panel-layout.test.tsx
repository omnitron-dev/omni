import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Link, useLocation } from 'react-router-dom';
import { PanelLayout } from './panel-layout.js';
import { DashboardLayout } from './dashboard/layout.js';
import { useSettingsStore } from '../state/stores/settings.js';

let desktop = true;
beforeEach(() => {
  useSettingsStore.getState().reset();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: desktop && query.includes('min-width'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return true;
      },
      onchange: null,
    }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  desktop = true;
});
const labels = { expand: 'Expand contents', collapse: 'Collapse contents', close: 'Close contents' };
function RoutedPanel(props: React.ComponentProps<typeof PanelLayout>) {
  const location = useLocation();
  return <PanelLayout {...props} navigationKey={location.key} />;
}
function Surface() {
  return (
    <MemoryRouter>
      <DashboardLayout
        persistKey="primary"
        navData={[{ id: 'work', items: [{ id: 'docs', title: 'Documents', path: '/', icon: <span>•</span> }] }]}
      >
        <RoutedPanel
          title="Contents"
          labels={labels}
          persistKey="secondary"
          panel={<input aria-label="Search chapters" defaultValue="" />}
        >
          <textarea aria-label="Document draft" defaultValue="Theorem" />
        </RoutedPanel>
      </DashboardLayout>
    </MemoryRouter>
  );
}
describe('independent application and document navigation', () => {
  it('retains document and panel state while collapsing either rail, and persists each preference independently', async () => {
    const view = render(<Surface />);
    const draft = screen.getByLabelText('Document draft');
    const search = screen.getByLabelText('Search chapters');
    fireEvent.change(draft, { target: { value: 'Unpublished proof' } });
    fireEvent.change(search, { target: { value: 'Continuity' } });
    fireEvent.click(screen.getByLabelText('Collapse contents'));
    expect(search).not.toBeVisible();
    fireEvent.click(screen.getByLabelText('Collapse sidebar'));
    await act(async () => {});
    expect(screen.getByLabelText('Documents')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Document draft')).toBe(draft);
    expect(draft).toHaveValue('Unpublished proof');
    fireEvent.click(screen.getByLabelText('Expand contents'));
    expect(screen.getByLabelText('Search chapters')).toBe(search);
    expect(search).toHaveValue('Continuity');
    expect(useSettingsStore.getState().sidebarCollapsed).toMatchObject({ primary: true, secondary: false });
    view.unmount();
    render(<Surface />);
    expect(screen.getByLabelText('Expand sidebar')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Collapse contents')).toHaveAttribute('aria-expanded', 'true');
  });
  it('keeps the content editable when preference storage is unavailable', () => {
    const original = window.localStorage;
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('quota');
      },
    });
    render(<Surface />);
    fireEvent.click(screen.getByLabelText('Collapse contents'));
    fireEvent.click(screen.getByLabelText('Expand contents'));
    expect(screen.getByLabelText('Document draft')).toHaveValue('Theorem');
    vi.stubGlobal('localStorage', original);
  });
  it('closes mobile contents after navigation, preserves its search on reopening, and never remounts the document', async () => {
    desktop = false;
    render(
      <MemoryRouter>
        <RoutedPanel
          title="Contents"
          labels={labels}
          panel={
            <>
              <input aria-label="Search chapters" />
              <Link to="/chapter/2">Chapter 2</Link>
            </>
          }
        >
          <textarea aria-label="Document draft" defaultValue="Theorem" />
        </RoutedPanel>
      </MemoryRouter>
    );
    const draft = screen.getByLabelText('Document draft');
    fireEvent.click(screen.getByRole('button', { name: 'Contents' }));
    expect(screen.getByRole('dialog', { name: 'Contents' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Search chapters'), { target: { value: 'Continuity' } });
    fireEvent.click(screen.getByRole('link', { name: 'Chapter 2' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Contents' })).toHaveAttribute('aria-expanded', 'false')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Contents' }));
    expect(screen.getByLabelText('Search chapters')).toHaveValue('Continuity');
    fireEvent.click(screen.getByLabelText('Close contents'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Contents' })).toBeNull());
    expect(screen.getByLabelText('Document draft')).toBe(draft);
  });
});
