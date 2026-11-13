import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CursorPagination } from './cursor-pagination.js';

describe('server cursor controls', () => {
  it('only exposes supplied directions and forwards actions without a page estimate', () => {
    const onFirst = vi.fn();
    const onNext = vi.fn();
    render(<CursorPagination first={onFirst} next={onNext} labels={{ navigation: 'Записи', next: 'Ещё' }} />);
    expect(screen.getByRole('navigation', { name: 'Записи' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
    expect(onNext).toHaveBeenCalledOnce();
    expect(onFirst).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('retains keyboard focus while loading, blocks repeat activation, then focuses an available direction', () => {
    const load = vi.fn(), back = vi.fn();
    const { rerender } = render(<CursorPagination first={null} next={load} />);
    const next = screen.getByRole('button', { name: 'Next page' });
    act(() => next.focus());
    rerender(<CursorPagination first={back} next={null} pending />);
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(next);
    fireEvent.click(screen.getByRole('button', { name: 'First page' }));
    expect(load).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    rerender(<CursorPagination first={back} next={null} />);
    expect(screen.getByRole('button', { name: 'First page' })).toHaveFocus();
    expect(next).toHaveAttribute('tabindex', '-1');
  });

  it('keeps native keyboard activation, supports append-only and previous-token APIs, and never steals outside focus', () => {
    const next = vi.fn(), previous = vi.fn();
    const { rerender } = render(<><button>Filter</button><CursorPagination next={next} /></>);
    screen.getByRole('button', { name: 'Filter' }).focus();
    rerender(<><button>Filter</button><CursorPagination previous={previous} next={null} /></>);
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveFocus();
    const back = screen.getByRole('button', { name: 'Previous page' });
    expect(back.tagName).toBe('BUTTON');
    fireEvent.click(back);
    expect(previous).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it('shows no navigation for an empty first page and retains a real status throughout the last append', () => {
    const { container, rerender } = render(<CursorPagination first={null} next={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CursorPagination next={null} status="No observations" />);
    expect(screen.getByRole('status')).toHaveTextContent('No observations');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<CursorPagination next={null} pending status="Loading observations" />);
    expect(screen.getByRole('navigation')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveAttribute('aria-disabled', 'true');
    rerender(<CursorPagination status={0} />);
    expect(screen.getByRole('status')).toHaveTextContent('0');
  });

  it('keeps focus on the final append until the user moves on, then removes the exhausted control', () => {
    const append = vi.fn();
    const page = (next: (() => void) | null, pending = false) =>
      <><CursorPagination next={next} pending={pending} /><button>Continue reading</button></>;
    const { rerender } = render(page(append));
    const next = screen.getByRole('button', { name: 'Next page' });
    act(() => next.focus());
    rerender(page(null, true));
    rerender(page(null));
    expect(next).toHaveFocus();
    fireEvent.click(next);
    expect(append).not.toHaveBeenCalled();
    act(() => screen.getByRole('button', { name: 'Continue reading' }).focus());
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue reading' })).toHaveFocus();
  });
});
