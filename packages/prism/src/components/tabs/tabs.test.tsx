import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabPanel, Tabs } from './tabs.js';

describe('Tabs', () => {
  describe('individual closure', () => {
    it('requests closure of an inactive tab without selecting it or nesting buttons', () => {
      const onClose = vi.fn(),
        onChange = vi.fn();
      const { container } = render(
        <Tabs
          value="a"
          onChange={onChange}
          onClose={onClose}
          tabs={[
            { value: 'a', label: 'A', closable: true },
            { value: 'b', label: 'B', closable: true },
          ]}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Close B' }));
      expect(onClose).toHaveBeenCalledWith('b');
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole('tab', { name: 'B' })).toBeInTheDocument();
      expect(container.querySelector('button button')).toBeNull();
    });

    it('supports Delete and moves focus only when the caller removes the tab', () => {
      const onClose = vi.fn();
      const tabs = [
        { value: 'a', label: 'A', closable: true },
        { value: 'b', label: 'B', closable: true },
      ];
      const { rerender } = render(<Tabs value="a" tabs={tabs} onClose={onClose} />);
      const first = screen.getByRole('tab', { name: 'A' });
      first.focus();
      fireEvent.keyDown(first, { key: 'Delete' });
      expect(onClose).toHaveBeenCalledWith('a');
      expect(first).toHaveFocus();
      rerender(<Tabs value="b" tabs={tabs.slice(1)} onClose={onClose} />);
      expect(screen.getByRole('tab', { name: 'B' })).toHaveFocus();
    });

    it('can suspend closure while keeping selection enabled', () => {
      const onClose = vi.fn(),
        onChange = vi.fn();
      render(
        <Tabs
          value="a"
          onChange={onChange}
          onClose={onClose}
          tabs={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B', closable: true, closeDisabled: true },
          ]}
        />
      );
      expect(screen.getByRole('button', { name: 'Close B' })).toBeDisabled();
      fireEvent.keyDown(screen.getByRole('tab', { name: 'B' }), { key: 'Delete' });
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('tab', { name: 'B' }));
      expect(onChange).toHaveBeenCalledWith('b');
    });

    it('selects and focuses the next enabled tab after the caller removes the active uncontrolled tab', () => {
      const onChange = vi.fn();
      const tabs = ['a', 'b', 'c', 'd'].map(value => ({
        value, label: value, content: value, disabled: value === 'c', closable: true,
      }));
      const draw = (items: typeof tabs) => <Tabs tabs={items} defaultValue="b" onClose={() => {}} onChange={onChange} />;
      const { rerender } = render(draw(tabs));
      fireEvent.keyDown(screen.getByRole('tab', { name: 'b' }), { key: 'Delete' });
      rerender(draw(tabs.filter(tab => tab.value !== 'b')));
      expect(screen.getByRole('tab', { name: 'd', selected: true })).toHaveFocus();
      expect(onChange).toHaveBeenCalledExactlyOnceWith('d');
    });
  });
  describe('panel rendering', () => {
    it('selects the first enabled TabPanel when the caller omits a default', () => {
      render(<Tabs aria-label="Manual">
        <TabPanel value="future" disabled>Coming soon</TabPanel>
        <TabPanel value="" label="Guide">Start here</TabPanel>
        <TabPanel value="api">Reference</TabPanel>
      </Tabs>);
      expect(screen.getByRole('tab', { name: 'Guide', selected: true })).toHaveAttribute('tabindex', '0');
      expect(screen.getByRole('tabpanel', { name: 'Guide' })).toHaveTextContent('Start here');
    });

    it('retains selection through reorder, then selects an available tab if the chosen one disappears', () => {
      const onChange = vi.fn();
      const a = { value: 'a', label: 'A', content: 'First' };
      const b = { value: 'b', label: 'B', content: 'Second' };
      const c = { value: 'c', label: 'C', content: 'Third' };
      const { rerender } = render(<Tabs tabs={[]} defaultValue="b" onChange={onChange} />);
      rerender(<Tabs tabs={[a, b, c]} onChange={onChange} />);
      expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('B');
      rerender(<Tabs tabs={[c, a, b]} onChange={onChange} />);
      expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('B');
      rerender(<Tabs tabs={[{ ...a, disabled: true }, c]} onChange={onChange} />);
      expect(screen.getByRole('tabpanel')).toHaveTextContent('Third');
      rerender(<Tabs tabs={[a, b, c]} onChange={onChange} />);
      expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('C');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('renders the panel of the active tab when content is provided', () => {
      render(
        <Tabs
          tabs={[
            { value: 'a', label: 'Tab A', content: <div>panel-a</div> },
            { value: 'b', label: 'Tab B', content: <div>panel-b</div> },
          ]}
          defaultValue="a"
        />
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
        />
      );
      expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(0);
    });
  });

  describe('action slot', () => {
    it('renders an action node to the right of the tab strip', () => {
      render(
        <Tabs tabs={[{ value: 'a', label: 'Tab A' }]} defaultValue="a" action={<button type="button">Create</button>} />
      );
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    });

    it('does not render an action when no action prop is provided', () => {
      render(<Tabs tabs={[{ value: 'a', label: 'Tab A' }]} defaultValue="a" />);
      // No "Create" button should exist; the only buttons in the
      // tree are the MUI tab buttons (role="tab").
      expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
      expect(screen.queryAllByRole('button').every((b) => b.getAttribute('role') === 'tab')).toBe(true);
    });

    it('treats null and false as no-action (truthiness gate)', () => {
      // Conditional rendering at call-sites ("show button only when
      // X") commonly evaluates to `null` or `false` — the slot
      // must not produce a stray empty Box in that case.
      const { rerender } = render(<Tabs tabs={[{ value: 'a', label: 'Tab A' }]} defaultValue="a" action={null} />);
      expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();

      rerender(<Tabs tabs={[{ value: 'a', label: 'Tab A' }]} defaultValue="a" action={false} />);
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
        />
      );
      fireEvent.click(screen.getByRole('tab', { name: 'Tab B' }));
      expect(onChange).toHaveBeenCalledWith('b');
    });
  });
});
