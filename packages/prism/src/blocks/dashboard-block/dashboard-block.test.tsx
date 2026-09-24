/**
 * A block that could not say «nothing here», or say anything in Russian.
 *
 * DashboardBlock had loading and error states and no empty one, so a caller
 * showing «no orders» drew it as content — and the first caller to reach for
 * the block with an error and an empty list at once would have to pick the
 * order itself. Its strings were English literals («Failed to load data»,
 * «Retry», «Expand block»), and a render crash inside one block took the
 * whole page down. The home page of the downstream portal is built from these
 * blocks, one per module, in two languages.
 */
import { useState, type ReactElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { createPrismTheme } from '../../theme/create-theme.js';
import { DashboardBlock } from './dashboard-block.js';

function themed(node: ReactElement) {
  return render(<ThemeProvider theme={createPrismTheme()}>{node}</ThemeProvider>);
}

const RU = { error: 'Не удалось загрузить', retry: 'Повторить', expand: 'Развернуть', collapse: 'Свернуть' };

describe('DashboardBlock', () => {
  it('draws a failure as a failure, even when the list it failed to load is empty', () => {
    themed(
      <DashboardBlock title="Заказы" error empty emptyConfig={{ title: 'Заказов нет' }} labels={RU}>
        <div>content</div>
      </DashboardBlock>
    );

    expect(screen.getByText('Не удалось загрузить')).toBeTruthy();
    expect(screen.queryByText('Заказов нет')).toBeNull();
    expect(screen.queryByText('content')).toBeNull();
  });

  it('says «nothing here» in its own words instead of drawing the content', () => {
    themed(
      <DashboardBlock title="Заказы" empty emptyConfig={{ title: 'Заказов нет', description: 'Всё сделано' }}>
        <div>content</div>
      </DashboardBlock>
    );

    expect(screen.getByTestId('prism-dashboard-block-empty')).toBeTruthy();
    expect(screen.getByText('Заказов нет')).toBeTruthy();
    expect(screen.queryByText('content')).toBeNull();
  });

  it('speaks the language it is given — the error, the retry and the collapse control', () => {
    const onRetry = vi.fn();
    themed(<DashboardBlock title="Баланс" collapsible error errorConfig={{ onRetry }} labels={RU} />);

    fireEvent.click(screen.getByText('Повторить'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Свернуть')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('keeps a crash inside the block, and recovers through its retry', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    function Fragile() {
      if (fail) throw new Error('render failed');
      return <div>recovered</div>;
    }
    function Page() {
      const [, rerender] = useState(0);
      return (
        <>
          <DashboardBlock title="Лента" labels={RU} errorConfig={{ onRetry: () => rerender((n) => n + 1) }}>
            <Fragile />
          </DashboardBlock>
          <div>the rest of the page</div>
        </>
      );
    }
    themed(<Page />);

    expect(screen.getByText('Не удалось загрузить')).toBeTruthy();
    expect(screen.getByText('the rest of the page')).toBeTruthy();

    fail = false;
    fireEvent.click(screen.getByText('Повторить'));
    expect(screen.getByText('recovered')).toBeTruthy();
  });
});
