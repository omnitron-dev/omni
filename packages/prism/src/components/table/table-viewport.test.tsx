import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TableViewport } from './table-viewport.js';
it('browses rows without stealing editable controls and distinguishes open from selection', () => {
  const open = vi.fn(),
    select = vi.fn();
  render(
    <TableViewport label="Jobs">
      <table>
        <tbody>
          <tr onClick={open}>
            <td>First</td>
            <td>
              <input aria-label="Selected" type="checkbox" onClick={(e) => e.stopPropagation()} onChange={select} />
            </td>
          </tr>
          <tr>
            <td>
              <input aria-label="Name" />
            </td>
          </tr>
        </tbody>
      </table>
    </TableViewport>
  );
  const viewport = screen.getByRole('region');
  viewport.focus();
  fireEvent.keyDown(viewport, { key: 'ArrowDown' });
  const first = document.activeElement;
  expect(first?.textContent).toContain('First');
  fireEvent.keyDown(first!, { key: ' ' });
  expect(select).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  fireEvent.keyDown(first!, { key: 'Enter' });
  expect(open).toHaveBeenCalledOnce();
  fireEvent.keyDown(first!, { key: 'Escape' });
  expect(document.activeElement).toBe(viewport);
  screen.getByLabelText('Name').focus();
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(document.activeElement).toBe(screen.getByLabelText('Name'));
});
describe('native ownership', () => {
  it('can leave row navigation to a specialized workspace', () => {
    render(
      <TableViewport keyboardNavigation={false}>
        <table>
          <tbody>
            <tr>
              <td>Files</td>
            </tr>
          </tbody>
        </table>
      </TableViewport>
    );
    const viewport = screen.getByRole('region');
    viewport.focus();
    expect(fireEvent.keyDown(viewport, { key: 'ArrowDown' })).toBe(true);
    expect(document.activeElement).toBe(viewport);
  });
});
