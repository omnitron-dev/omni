import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { PrismDatePicker, datePickerRuRU, datePickerEnUS } from './index.js';
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <LocalizationProvider
      dateAdapter={AdapterDayjs}
      adapterLocale="ru"
      localeText={datePickerRuRU.components.MuiLocalizationProvider.defaultProps.localeText}
    >
      {children}
    </LocalizationProvider>
  );
}
describe('Prism calendar control', () => {
  it('uses localized MUI segmented editing and clears explicitly', async () => {
    const changed = vi.fn();
    render(<PrismDatePicker label="Дата" invalidText="Некорректная дата" value="2026-10-25" onChange={changed} />, {
      wrapper,
    });
    expect(screen.getAllByRole('spinbutton').length).toBe(3);
    expect(screen.getByRole('button', { name: /Выберите дату/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Очистить значение' }));
    expect(changed).toHaveBeenLastCalledWith('');
  });
  it('keeps an incomplete draft visible and prevents submitting an old valid value', async () => {
    const changed = vi.fn();
    const { container } = render(
      <form>
        <PrismDatePicker
          name="date"
          label="Дата"
          invalidText="Некорректная дата"
          value="2026-10-25"
          onChange={changed}
        />
      </form>,
      { wrapper }
    );
    const day = screen.getByRole('spinbutton', { name: 'День' });
    fireEvent.click(day);
    fireEvent.keyDown(day, { key: 'Delete' });
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(''));
    const input = container.querySelector('input[name="date"]') as HTMLInputElement;
    expect(input.checkValidity()).toBe(false);
    expect(screen.getByRole('spinbutton', { name: 'Месяц' }).textContent).toBe('10');
    fireEvent.click(screen.getByRole('button', { name: 'Очистить значение' }));
    await waitFor(() => expect(input.checkValidity()).toBe(true));
  });
  it('switches accessible section labels and formatting without changing the stored date', () => {
    const changed = vi.fn();
    const field = <PrismDatePicker label="Date" invalidText="Invalid date" value="2026-10-25" onChange={changed} />;
    const { rerender } = render(
      <LocalizationProvider
        dateAdapter={AdapterDayjs}
        adapterLocale="ru"
        localeText={datePickerRuRU.components.MuiLocalizationProvider.defaultProps.localeText}
      >
        {field}
      </LocalizationProvider>
    );
    expect(screen.getByRole('spinbutton', { name: 'День' }).textContent).toBe('25');
    rerender(
      <LocalizationProvider
        dateAdapter={AdapterDayjs}
        adapterLocale="en"
        localeText={datePickerEnUS.components.MuiLocalizationProvider.defaultProps.localeText}
      >
        {field}
      </LocalizationProvider>
    );
    expect(screen.getByRole('spinbutton', { name: 'Day' }).textContent).toBe('25');
    expect(screen.getByRole('spinbutton', { name: 'Month' }).textContent).toBe('10');
    expect(changed).not.toHaveBeenCalled();
  });
  it('rejects an out-of-range value at the form boundary rather than submitting it silently', async () => {
    const valid = vi.fn();
    const { container } = render(
      <form>
        <PrismDatePicker
          label="Дата"
          name="date"
          invalidText="Некорректная дата"
          value="2026-10-25"
          max="2026-10-24"
          onChange={() => {}}
          onValidityChange={valid}
        />
      </form>,
      { wrapper }
    );
    await waitFor(() => expect(valid).toHaveBeenLastCalledWith(false));
    expect(screen.getByText('Некорректная дата')).toBeTruthy();
    const input = container.querySelector('input[name="date"]') as HTMLInputElement;
    expect(input.validationMessage).toBe('Некорректная дата');
    expect(input.checkValidity()).toBe(false);
  });
});
