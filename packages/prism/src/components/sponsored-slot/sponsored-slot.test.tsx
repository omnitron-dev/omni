/**
 * A sponsored slot: marked, sized, and gone when there is nothing to show.
 */
import type { ReactElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { createPrismTheme } from '../../theme/create-theme.js';
import { SponsoredSlot } from './sponsored-slot.js';

const themed = (node: ReactElement) => render(<ThemeProvider theme={createPrismTheme()}>{node}</ThemeProvider>);
const content = { title: 'Горная тропа', body: 'Снаряжение и карты', image: '/i.webp', cta: 'Открыть' };

describe('SponsoredSlot', () => {
  it('collapses to nothing when there is nothing to show', () => {
    const { container } = themed(<SponsoredSlot content={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps its box while the placement is asked for', () => {
    const { container } = themed(<SponsoredSlot content={undefined} loading />);
    expect(container.querySelector('[data-sponsored-pending]')).not.toBeNull();
  });

  it('is marked as advertising in the reader’s words — by the advertiser when named', () => {
    const { rerender } = themed(<SponsoredSlot content={content} labels={{ sponsored: 'Реклама' }} />);
    expect(screen.getByText('Реклама')).toBeInTheDocument();
    rerender(
      <ThemeProvider theme={createPrismTheme()}>
        <SponsoredSlot content={{ ...content, byline: 'Реклама · Лавка у реки' }} labels={{ sponsored: 'Реклама' }} />
      </ThemeProvider>
    );
    expect(screen.getByText('Реклама · Лавка у реки')).toBeInTheDocument();
  });

  it('says why it is here, from the page’s context', () => {
    themed(<SponsoredSlot content={{ ...content, because: 'Потому что вы в разделе «Туризм»' }} />);
    expect(screen.getByLabelText('Потому что вы в разделе «Туризм»')).toBeInTheDocument();
  });

  it('leads where it is linked, and reports the opening; without a link it is not a control', () => {
    const onOpen = vi.fn();
    const { unmount } = themed(
      <SponsoredSlot content={content} link={{ component: 'a', props: { href: '/shops/river' } }} onOpen={onOpen} id="b-1" />
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/shops/river');
    expect(screen.getByText('Открыть')).toBeInTheDocument();
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
    unmount();

    themed(<SponsoredSlot content={content} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Открыть')).toBeNull();
  });
});
