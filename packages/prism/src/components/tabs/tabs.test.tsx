import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs } from './tabs.js';

describe('Tabs', () => {
  describe('panel rendering', () => {
    it('renders the panel of the active tab when content is provided', () => {
      render(
        <Tabs
          tabs={[
            { value: 'a', label: 'Tab A', content: <div>panel-a</div> },
            { value: 'b', label: 'Tab B', content: <div>panel-b</div> },
          ]}
          defaultValue="a"
        />,
      );
      expect(screen.getByText('panel-a')).toBeInTheDocument();
      expect(screen.queryByText('panel-b')).not.toBeInTheDocument();
    });

    it('skips the panel box entirely when tabs have no content (strip-only mode)', () => {
      // Strip-only callers (e.g. pages that own their content
      // rendering below the tabs) must not get an empty 16px panel
      // gap underneath the tab strip.
      const { container } = render(
        <Tabs
          tabs={[
            { value: 'a', label: 'Tab A' },
            { value: 'b', label: 'Tab B' },
          ]}
          defaultValue="a"
        />,
      );
      expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(0);
    });
  });

  describe('action slot', () => {
    it('renders an action node to the right of the tab strip', () => {
      render(
        <Tabs
          tabs={[{ value: 'a', label: 'Tab A' }]}
          defaultValue="a"
          action={<button type="button">Create</button>}
        />,
      );
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    });

    it('does not render an action when no action prop is provided', () => {
      render(
        <Tabs tabs={[{ value: 'a', label: 'Tab A' }]} defaultValue="a" />,
      );
      // No "Create" button should exist; the only buttons in the
      // tree are the MUI tab buttons (role="tab").
      expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
      expect(screen.queryAllByRole('button').every((b) => b.getAttribute('role') === 'tab')).toBe(
        true,
      );
    });

    it('treats null and false as no-action (truthiness gate)', () => {
      // Conditional rendering at call-sites ("show button only when
      // X") commonly evaluates to `null` or `false` — the slot
      // must not produce a stray empty Box in that case.
      const { rerender } = render(
        <Tabs
          tabs={[{ value: 'a', label: 'Tab A' }]}
          defaultValue="a"
          action={null}
        />,
      );
      expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();

      rerender(
        <Tabs
          tabs={[{ value: 'a', label: 'Tab A' }]}
          defaultValue="a"
          action={false}
        />,
      );
      expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
    });
  });

  describe('controlled mode', () => {
    it('calls onChange with the new tab value (string-typed signature)', () => {
      const onChange = vi.fn();
      render(
        <Tabs
          tabs={[
            { value: 'a', label: 'Tab A' },
            { value: 'b', label: 'Tab B' },
          ]}
          value="a"
          onChange={onChange}
        />,
      );
      fireEvent.click(screen.getByRole('tab', { name: 'Tab B' }));
      expect(onChange).toHaveBeenCalledWith('b');
    });
  });
});
