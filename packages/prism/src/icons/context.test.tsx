import { createRef, forwardRef } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import SvgIcon, { type SvgIconProps } from '@mui/material/SvgIcon';
import { ThemeProvider } from '@mui/material/styles';
import Dialog from '@mui/material/Dialog';
import Checkbox from '@mui/material/Checkbox';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Alert from '@mui/material/Alert';
import { PrismIconProvider, createPrismIcon } from './context.js';
import { SearchIcon, CloseIcon } from './controls.js';
import { createPrismTheme } from '../theme/create-theme.js';

const artwork = (name: string) =>
  forwardRef<SVGSVGElement, SvgIconProps>(function Artwork(props, ref) {
    return (
      <SvgIcon {...props} ref={ref} data-artwork={name}>
        <path opacity="0.4" d="M2 2h20v20H2z" />
      </SvgIcon>
    );
  });
const Search = artwork('search');
const Close = artwork('close');
const Alternate = artwork('alternate');
afterEach(cleanup);

describe('application-owned icon family', () => {
  it('inherits partial sets through portals, without leaking into neighbouring roots', () => {
    render(
      <>
        <PrismIconProvider icons={{ search: Search, close: Close }}>
          <SearchIcon data-testid="parent" />
          <PrismIconProvider icons={{ search: Alternate }}>
            <SearchIcon data-testid="child" />
            <Dialog open aria-label="Icon portal">
              <CloseIcon data-testid="portal" />
            </Dialog>
          </PrismIconProvider>
        </PrismIconProvider>
        <SearchIcon data-testid="outside" />
      </>
    );
    expect(screen.getByTestId('parent').getAttribute('data-artwork')).toBe('search');
    expect(screen.getByTestId('child').getAttribute('data-artwork')).toBe('alternate');
    expect(screen.getByTestId('portal').getAttribute('data-artwork')).toBe('close');
    expect(screen.getByTestId('outside').hasAttribute('data-artwork')).toBe(false);
  });
  it('forwards ref, accessible title, class and source opacity; keeps focused controls on updates', () => {
    const ref = createRef<SVGSVGElement>();
    const Icon = createPrismIcon('search', Search);
    const view = (selected: typeof Search) => (
      <PrismIconProvider icons={{ search: selected }}>
        <button aria-label="Search">
          <Icon ref={ref} titleAccess="Find" className="marker" />
        </button>
      </PrismIconProvider>
    );
    const { rerender } = render(view(Search));
    const button = screen.getByRole('button', { name: 'Search' });
    button.focus();
    expect(ref.current).toBe(screen.getByRole('img', { name: 'Find' }));
    expect(ref.current?.classList.contains('marker')).toBe(true);
    expect(ref.current?.querySelector('path')?.getAttribute('opacity')).toBe('0.4');
    rerender(view(Alternate));
    expect(document.activeElement).toBe(button);
    expect(ref.current?.getAttribute('data-artwork')).toBe('alternate');
  });
  it('uses configured MUI slots without changing selection, notification or input behaviour', () => {
    const theme = createPrismTheme({ responsiveFonts: false });
    render(
      <PrismIconProvider
        icons={{ checkbox: Search, checkboxChecked: Close, chevronDown: Alternate, info: Search, close: Close }}
      >
        <ThemeProvider theme={theme}>
          <Checkbox slotProps={{ input: { 'aria-label': 'Accept' } }} />
          <Select defaultValue="a" inputProps={{ 'aria-label': 'Source language' }}>
            <MenuItem value="a">Russian</MenuItem>
            <MenuItem value="b">English</MenuItem>
          </Select>
          <Alert severity="info" onClose={() => {}}>
            Saved
          </Alert>
        </ThemeProvider>
      </PrismIconProvider>
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Accept' }) as HTMLInputElement;
    expect(checkbox.parentElement?.querySelector('svg')?.getAttribute('data-artwork')).toBe('search');
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(checkbox.parentElement?.querySelector('svg')?.getAttribute('data-artwork')).toBe('close');
    const select = screen.getByRole('combobox');
    expect(select.parentElement?.querySelector('svg')?.getAttribute('data-artwork')).toBe('alternate');
    fireEvent.mouseDown(select);
    fireEvent.click(screen.getByRole('option', { name: 'English' }));
    expect(select.textContent).toBe('English');
    expect(screen.getByRole('alert').querySelector('[data-prism-icon="info"]')?.getAttribute('data-artwork')).toBe(
      'search'
    );
    expect(screen.getByRole('button', { name: 'Close' }).querySelector('svg')?.getAttribute('data-artwork')).toBe(
      'close'
    );
  });
});
