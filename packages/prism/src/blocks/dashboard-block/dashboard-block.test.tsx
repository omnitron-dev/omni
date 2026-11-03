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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { createPrismTheme } from '../../theme/create-theme.js';
import { DashboardBlock, useDashboardBlockContext } from './dashboard-block.js';
import { useDashboardBlock } from './use-dashboard-block.js';

function themed(node: ReactElement) {
  return render(<ThemeProvider theme={createPrismTheme()}>{node}</ThemeProvider>);
}

const RU = { error: 'Не удалось загрузить', retry: 'Повторить', expand: 'Развернуть', collapse: 'Свернуть' };

describe('DashboardBlock', () => {
  it.each([undefined, false])('has no collapse affordance when capability is %s, even with a collapsed prop', collapsible => {
    const onChange = vi.fn();
    function Probe() {
      const context = useDashboardBlockContext();
      return <><output>{String(context.collapsible) + ':' + String(context.collapsed)}</output>
        <button onClick={() => { context.setCollapsed(true); context.toggleCollapse(); }}>Request collapse</button></>;
    }
    themed(<DashboardBlock title="Fixed" collapsible={collapsible} collapsed defaultCollapsed onCollapseChange={onChange} footer="Footer"><Probe /></DashboardBlock>);
    expect(screen.queryByTestId('prism-dashboard-block-collapse')).toBeNull();
    expect(screen.getByText('false:false')).toBeVisible();
    expect(screen.getByText('Footer')).toBeVisible();
    fireEvent.click(screen.getByText('Request collapse'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('false:false')).toBeVisible();
  });

  it.each([false, true])('owns uncontrolled state starting at %s and notifies changes', async defaultCollapsed => {
    const onChange = vi.fn();
    themed(<DashboardBlock title="Local" collapsible defaultCollapsed={defaultCollapsed} onCollapseChange={onChange} footer="Footer">Body</DashboardBlock>);
    const button = screen.getByTestId('prism-dashboard-block-collapse');
    expect(button).toHaveAttribute('aria-expanded', String(!defaultCollapsed));
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(!defaultCollapsed);
    expect(button).toHaveAttribute('aria-expanded', String(defaultCollapsed));
    await waitFor(() => defaultCollapsed ? expect(screen.getByText('Body')).toBeVisible() : expect(screen.getByText('Body')).not.toBeVisible());
    if (defaultCollapsed) expect(screen.getByText('Footer')).toBeVisible();
    else expect(screen.queryByText('Footer')).toBeNull();
  });

  it('leaves controlled state with the caller and requests the next value once', () => {
    const onChange = vi.fn();
    const view = themed(<DashboardBlock title="Controlled" collapsible collapsed={false} onCollapseChange={onChange}>Body</DashboardBlock>);
    fireEvent.click(screen.getByTestId('prism-dashboard-block-collapse'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.getByTestId('prism-dashboard-block-collapse')).toHaveAttribute('aria-expanded', 'true');
    view.rerender(<ThemeProvider theme={createPrismTheme()}><DashboardBlock title="Controlled" collapsible collapsed onCollapseChange={onChange}>Body</DashboardBlock></ThemeProvider>);
    fireEvent.click(screen.getByTestId('prism-dashboard-block-collapse'));
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([true, false]);
    expect(screen.getByTestId('prism-dashboard-block-collapse')).toHaveAttribute('aria-expanded', 'false');
  });

  it('connects the public hook to an explicitly collapsible block', () => {
    function Widget() {
      const { state, actions, blockProps } = useDashboardBlock();
      return <><output>{state.collapsed ? 'closed' : 'open'}</output><button onClick={actions.expand}>External expand</button>
        <DashboardBlock title="Hook" collapsible {...blockProps}>Body</DashboardBlock></>;
    }
    themed(<Widget />);
    fireEvent.click(screen.getByTestId('prism-dashboard-block-collapse'));
    expect(screen.getByText('closed')).toBeVisible();
    expect(screen.getByTestId('prism-dashboard-block-collapse')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByText('External expand'));
    expect(screen.getByText('open')).toBeVisible();
    expect(screen.getByTestId('prism-dashboard-block-collapse')).toHaveAttribute('aria-expanded', 'true');
  });

  it.each(['loading', 'error', 'empty'] as const)('collapses the %s body through the same block state', async state => {
    themed(<DashboardBlock title="State" collapsible {...{ [state]: true }}
      loadingConfig={{ loadingComponent: <div>State body</div> }}
      errorConfig={{ errorComponent: <div>State body</div> }}
      emptyConfig={{ emptyComponent: <div>State body</div> }}>Content</DashboardBlock>);
    expect(screen.getByText('State body')).toBeVisible();
    fireEvent.click(screen.getByTestId('prism-dashboard-block-collapse'));
    await waitFor(() => expect(screen.getByText('State body')).not.toBeVisible());
    fireEvent.click(screen.getByTestId('prism-dashboard-block-collapse'));
    await waitFor(() => expect(screen.getByText('State body')).toBeVisible());
  });

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

  // The CSS the browser is handed for the element's own class, read from the
  // text emotion writes. Not from jsdom's view of it: its parser drops
  // `-webkit-line-clamp`, and `getComputedStyle` never reports the
  // `calc(100vh - 240px)` this court is about — both checks passed with the
  // defects planted back until they read the text.
  function emittedCss(el: Element): string {
    const text = Array.from(document.querySelectorAll('style'), (s) => s.textContent ?? '').join('\n');
    return Array.from(el.classList)
      .filter((c) => c.startsWith('css-'))
      .flatMap((c) => text.match(new RegExp(`\\.${c}\\{[^}]*\\}`, 'g')) ?? [])
      .join('\n');
  }

  // Every rule under the empty state that sizes something by the viewport.
  function viewportRules(root: HTMLElement): string[] {
    return [root, ...Array.from(root.querySelectorAll('*'))].map(emittedCss).filter((css) => /\d+vh/.test(css));
  }

  it('sizes an empty block to its words, not to the viewport — a block is a card', () => {
    themed(
      <DashboardBlock title="Задачи" empty emptyConfig={{ title: 'Всё сделано' }}>
        <div>content</div>
      </DashboardBlock>,
    );
    expect(viewportRules(screen.getByTestId('prism-dashboard-block-empty'))).toEqual([]);
  });

  it('lets a long title take a second line instead of cutting it to one', () => {
    themed(<DashboardBlock title="Лента сообществ">content</DashboardBlock>);
    const title = screen.getByRole('heading', { name: 'Лента сообществ' });
    const css = emittedCss(title);
    expect(css).not.toContain('white-space:nowrap');
    expect(css).toContain('-webkit-line-clamp:2');
  });
});
