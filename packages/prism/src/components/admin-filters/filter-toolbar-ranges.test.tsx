import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FilterToolbar } from './filter-toolbar.js';

// The picker owns date entry; this suite tests the toolbar's controlled-state boundary.
vi.mock('../date-range-picker/date-range-input.js', () => ({
  DateRangeInput: ({ onChange }: { onChange: (from: string, to: string) => void }) => (
    <button onClick={() => onChange('2026-10-01', '2026-10-29')}>Apply dates</button>
  ),
}));

describe('range filters', () => {
  it('applies both ends atomically without overwriting another filter', () => {
    const onChange = vi.fn();
    render(
      <FilterToolbar
        filters={[{ key: 'date', type: 'date-range', label: 'Date' }]}
        values={{ status: 'active' }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      status: 'active',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-29',
    });
  });

  it.each([{ dateTo: '2026-10-29' }, { amountMin: 0 }])('allows resetting a partial range: %j', (values) => {
    const onChange = vi.fn();
    render(
      <FilterToolbar
        filters={[
          { key: 'date', type: 'date-range', label: 'Date' },
          { key: 'amount', type: 'number-range', label: 'Amount' },
        ]}
        values={values}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onChange).toHaveBeenCalledWith({ dateFrom: '', dateTo: '', amountMin: '', amountMax: '' });
  });
});
