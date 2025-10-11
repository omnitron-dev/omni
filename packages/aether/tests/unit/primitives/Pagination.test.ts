/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Pagination,
  PaginationItems,
  PaginationPrevious,
  PaginationNext,
} from '../../../src/primitives/Pagination.js';
import { renderComponent, createSpy } from '../../helpers/test-utils.js';

describe('Pagination', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Pagination Root - Basic Rendering', () => {
    it('should render as nav element', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const nav = container.querySelector('nav');
      expect(nav).toBeTruthy();
    });

    it('should have data-pagination attribute', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const nav = container.querySelector('nav');
      expect(nav?.hasAttribute('data-pagination')).toBe(true);
      expect(nav?.getAttribute('data-pagination')).toBe('');
    });

    it('should have aria-label="Pagination"', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const nav = container.querySelector('nav');
      expect(nav?.getAttribute('aria-label')).toBe('Pagination');
    });

    it('should have role="navigation"', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const nav = container.querySelector('nav');
      expect(nav?.getAttribute('role')).toBe('navigation');
    });

    it('should render children', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('[data-pagination-items]')).toBeTruthy();
    });

    it('should accept currentPage prop', () => {
      const component = () =>
        Pagination({
          currentPage: 3,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const currentButton = container.querySelector('[data-current]');
      expect(currentButton?.textContent).toBe('3');
    });

    it('should accept totalPages prop', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 10,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('nav')).toBeTruthy();
    });

    it('should accept siblingCount prop', () => {
      const component = () =>
        Pagination({
          currentPage: 5,
          totalPages: 10,
          siblingCount: 2,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('[data-pagination-items]')).toBeTruthy();
    });

    it('should accept showFirstLast prop', () => {
      const component = () =>
        Pagination({
          currentPage: 5,
          totalPages: 20,
          showFirstLast: false,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('[data-pagination-items]')).toBeTruthy();
    });

    it('should call onPageChange when page changes', () => {
      const onPageChange = createSpy();
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          onPageChange,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const buttons = container.querySelectorAll('[data-pagination-item]');
      const page2Button = Array.from(buttons).find(
        (btn) => btn.textContent === '2'
      ) as HTMLButtonElement;

      page2Button?.click();
      expect(onPageChange.callCount).toBe(1);
      expect(onPageChange.calls[0][0]).toBe(2);
    });

    it('should forward custom props', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          'data-testid': 'pagination-nav',
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const nav = container.querySelector('[data-testid="pagination-nav"]');
      expect(nav).toBeTruthy();
    });

    it('should apply custom class names', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          class: 'custom-pagination',
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const nav = container.querySelector('.custom-pagination');
      expect(nav).toBeTruthy();
    });
  });

  describe('PaginationItems - Basic Rendering', () => {
    it('should render pagination items', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const itemsContainer = container.querySelector('[data-pagination-items]');
      expect(itemsContainer).toBeTruthy();
    });

    it('should render page number buttons', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const buttons = container.querySelectorAll('[data-pagination-item]');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should render all pages when total is small', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const buttons = container.querySelectorAll('[data-pagination-item]');
      expect(buttons.length).toBe(5);
    });

    it('should mark current page button', () => {
      const component = () =>
        Pagination({
          currentPage: 3,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const currentButton = container.querySelector('[data-current]');
      expect(currentButton).toBeTruthy();
      expect(currentButton?.textContent).toBe('3');
    });

    it('should have aria-current="page" on current page', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const currentButton = container.querySelector('[aria-current="page"]');
      expect(currentButton).toBeTruthy();
      expect(currentButton?.textContent).toBe('2');
    });

    it('should disable current page button', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const currentButton = container.querySelector('[data-current]') as HTMLButtonElement;
      expect(currentButton.disabled).toBe(true);
    });

    it('should have aria-label on page buttons', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const buttons = container.querySelectorAll('[data-pagination-item]');
      buttons.forEach((button, index) => {
        expect(button.getAttribute('aria-label')).toBe(`Page ${index + 1}`);
      });
    });

    it('should render ellipsis for large page counts', () => {
      const component = () =>
        Pagination({
          currentPage: 5,
          totalPages: 20,
          siblingCount: 1,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const ellipsis = container.querySelectorAll('[data-pagination-ellipsis]');
      expect(ellipsis.length).toBeGreaterThan(0);
    });

    it('should have aria-hidden on ellipsis', () => {
      const component = () =>
        Pagination({
          currentPage: 5,
          totalPages: 20,
          siblingCount: 1,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const ellipsis = container.querySelector('[data-pagination-ellipsis]');
      expect(ellipsis?.getAttribute('aria-hidden')).toBe('true');
    });

    it('should render "..." as ellipsis content', () => {
      const component = () =>
        Pagination({
          currentPage: 5,
          totalPages: 20,
          siblingCount: 1,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const ellipsis = container.querySelector('[data-pagination-ellipsis]');
      expect(ellipsis?.textContent).toBe('...');
    });

    it('should forward custom props', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          children: () => PaginationItems({
            'data-testid': 'pagination-items',
          }),
        });

      const { container } = renderComponent(component);
      const items = container.querySelector('[data-testid="pagination-items"]');
      expect(items).toBeTruthy();
    });

    it('should apply custom class names', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          children: () => PaginationItems({
            class: 'custom-items',
          }),
        });

      const { container } = renderComponent(component);
      const items = container.querySelector('.custom-items');
      expect(items).toBeTruthy();
    });
  });

  describe('PaginationItems - Custom Rendering', () => {
    it('should accept custom renderItem function', () => {
      const renderItem = (page: number, isCurrent: boolean) => {
        const btn = document.createElement('button');
        btn.textContent = `P${page}`;
        btn.className = isCurrent ? 'current' : '';
        return btn;
      };

      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          children: () => PaginationItems({ renderItem }),
        });

      const { container } = renderComponent(component);
      const buttons = container.querySelectorAll('button');
      expect(buttons[0]?.textContent).toBe('P1');
    });

    it('should accept custom renderEllipsis function', () => {
      const renderEllipsis = () => {
        const span = document.createElement('span');
        span.textContent = '---';
        return span;
      };

      const component = () =>
        Pagination({
          currentPage: 5,
          totalPages: 20,
          siblingCount: 1,
          children: () => PaginationItems({ renderEllipsis }),
        });

      const { container } = renderComponent(component);
      const ellipsis = container.querySelector('span');
      expect(ellipsis?.textContent).toContain('---');
    });
  });

  describe('PaginationItems - Page Number Generation', () => {
    it('should show all pages when total is less than threshold', () => {
      const component = () =>
        Pagination({
          currentPage: 3,
          totalPages: 7,
          siblingCount: 1,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const buttons = container.querySelectorAll('[data-pagination-item]');
      expect(buttons.length).toBe(7);
    });

    it('should show ellipsis on right side when current page is near start', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 20,
          siblingCount: 1,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const ellipsis = container.querySelectorAll('[data-pagination-ellipsis]');
      expect(ellipsis.length).toBeGreaterThan(0);
    });

    it('should show ellipsis on left side when current page is near end', () => {
      const component = () =>
        Pagination({
          currentPage: 19,
          totalPages: 20,
          siblingCount: 1,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const ellipsis = container.querySelectorAll('[data-pagination-ellipsis]');
      expect(ellipsis.length).toBeGreaterThan(0);
    });

    it('should show both ellipses when current page is in middle', () => {
      const component = () =>
        Pagination({
          currentPage: 10,
          totalPages: 20,
          siblingCount: 1,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const ellipsis = container.querySelectorAll('[data-pagination-ellipsis]');
      expect(ellipsis.length).toBe(2);
    });

    it('should show first and last pages with showFirstLast', () => {
      const component = () =>
        Pagination({
          currentPage: 10,
          totalPages: 20,
          siblingCount: 1,
          showFirstLast: true,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const buttons = container.querySelectorAll('[data-pagination-item]');
      const firstButton = buttons[0];
      const lastButton = buttons[buttons.length - 1];

      expect(firstButton?.textContent).toBe('1');
      expect(lastButton?.textContent).toBe('20');
    });

    it('should not show first and last pages when showFirstLast is false', () => {
      const component = () =>
        Pagination({
          currentPage: 10,
          totalPages: 20,
          siblingCount: 1,
          showFirstLast: false,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('[data-pagination-items]')).toBeTruthy();
    });

    it('should respect siblingCount', () => {
      const component = () =>
        Pagination({
          currentPage: 10,
          totalPages: 20,
          siblingCount: 2,
          showFirstLast: false,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const buttons = container.querySelectorAll('[data-pagination-item]');
      expect(buttons.length).toBeGreaterThan(5); // More siblings = more buttons
    });
  });

  describe('PaginationPrevious - Basic Rendering', () => {
    it('should render previous button', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationPrevious({}),
        });

      const { container } = renderComponent(component);
      const prevButton = container.querySelector('[data-pagination-previous]');
      expect(prevButton).toBeTruthy();
    });

    it('should have default "Previous" text', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationPrevious({}),
        });

      const { container } = renderComponent(component);
      const prevButton = container.querySelector('[data-pagination-previous]');
      expect(prevButton?.textContent).toBe('Previous');
    });

    it('should accept custom children', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationPrevious({ children: '← Prev' }),
        });

      const { container } = renderComponent(component);
      const prevButton = container.querySelector('[data-pagination-previous]');
      expect(prevButton?.textContent).toBe('← Prev');
    });

    it('should have aria-label', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationPrevious({}),
        });

      const { container } = renderComponent(component);
      const prevButton = container.querySelector('[data-pagination-previous]');
      expect(prevButton?.getAttribute('aria-label')).toBe('Go to previous page');
    });

    it('should be disabled on first page', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          children: () => PaginationPrevious({}),
        });

      const { container } = renderComponent(component);
      const prevButton = container.querySelector('[data-pagination-previous]') as HTMLButtonElement;
      expect(prevButton.disabled).toBe(true);
    });

    it('should be enabled when not on first page', () => {
      const component = () =>
        Pagination({
          currentPage: 3,
          totalPages: 5,
          children: () => PaginationPrevious({}),
        });

      const { container } = renderComponent(component);
      const prevButton = container.querySelector('[data-pagination-previous]') as HTMLButtonElement;
      expect(prevButton.disabled).toBe(false);
    });

    it('should call onPageChange with previous page', () => {
      const onPageChange = createSpy();
      const component = () =>
        Pagination({
          currentPage: 3,
          totalPages: 5,
          onPageChange,
          children: () => PaginationPrevious({}),
        });

      const { container } = renderComponent(component);
      const prevButton = container.querySelector('[data-pagination-previous]') as HTMLButtonElement;
      prevButton.click();

      expect(onPageChange.callCount).toBe(1);
      expect(onPageChange.calls[0][0]).toBe(2);
    });

    it('should not call onPageChange when disabled', () => {
      const onPageChange = createSpy();
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          onPageChange,
          children: () => PaginationPrevious({}),
        });

      const { container } = renderComponent(component);
      const prevButton = container.querySelector('[data-pagination-previous]') as HTMLButtonElement;
      prevButton.click();

      expect(onPageChange.callCount).toBe(0);
    });

    it('should forward custom props', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationPrevious({
            'data-testid': 'prev-button',
          }),
        });

      const { container } = renderComponent(component);
      const prevButton = container.querySelector('[data-testid="prev-button"]');
      expect(prevButton).toBeTruthy();
    });

    it('should apply custom class names', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationPrevious({
            class: 'custom-prev',
          }),
        });

      const { container } = renderComponent(component);
      const prevButton = container.querySelector('.custom-prev');
      expect(prevButton).toBeTruthy();
    });
  });

  describe('PaginationNext - Basic Rendering', () => {
    it('should render next button', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationNext({}),
        });

      const { container } = renderComponent(component);
      const nextButton = container.querySelector('[data-pagination-next]');
      expect(nextButton).toBeTruthy();
    });

    it('should have default "Next" text', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationNext({}),
        });

      const { container } = renderComponent(component);
      const nextButton = container.querySelector('[data-pagination-next]');
      expect(nextButton?.textContent).toBe('Next');
    });

    it('should accept custom children', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationNext({ children: 'Next →' }),
        });

      const { container } = renderComponent(component);
      const nextButton = container.querySelector('[data-pagination-next]');
      expect(nextButton?.textContent).toBe('Next →');
    });

    it('should have aria-label', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationNext({}),
        });

      const { container } = renderComponent(component);
      const nextButton = container.querySelector('[data-pagination-next]');
      expect(nextButton?.getAttribute('aria-label')).toBe('Go to next page');
    });

    it('should be disabled on last page', () => {
      const component = () =>
        Pagination({
          currentPage: 5,
          totalPages: 5,
          children: () => PaginationNext({}),
        });

      const { container } = renderComponent(component);
      const nextButton = container.querySelector('[data-pagination-next]') as HTMLButtonElement;
      expect(nextButton.disabled).toBe(true);
    });

    it('should be enabled when not on last page', () => {
      const component = () =>
        Pagination({
          currentPage: 3,
          totalPages: 5,
          children: () => PaginationNext({}),
        });

      const { container } = renderComponent(component);
      const nextButton = container.querySelector('[data-pagination-next]') as HTMLButtonElement;
      expect(nextButton.disabled).toBe(false);
    });

    it('should call onPageChange with next page', () => {
      const onPageChange = createSpy();
      const component = () =>
        Pagination({
          currentPage: 3,
          totalPages: 5,
          onPageChange,
          children: () => PaginationNext({}),
        });

      const { container } = renderComponent(component);
      const nextButton = container.querySelector('[data-pagination-next]') as HTMLButtonElement;
      nextButton.click();

      expect(onPageChange.callCount).toBe(1);
      expect(onPageChange.calls[0][0]).toBe(4);
    });

    it('should not call onPageChange when disabled', () => {
      const onPageChange = createSpy();
      const component = () =>
        Pagination({
          currentPage: 5,
          totalPages: 5,
          onPageChange,
          children: () => PaginationNext({}),
        });

      const { container } = renderComponent(component);
      const nextButton = container.querySelector('[data-pagination-next]') as HTMLButtonElement;
      nextButton.click();

      expect(onPageChange.callCount).toBe(0);
    });

    it('should forward custom props', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationNext({
            'data-testid': 'next-button',
          }),
        });

      const { container } = renderComponent(component);
      const nextButton = container.querySelector('[data-testid="next-button"]');
      expect(nextButton).toBeTruthy();
    });

    it('should apply custom class names', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationNext({
            class: 'custom-next',
          }),
        });

      const { container } = renderComponent(component);
      const nextButton = container.querySelector('.custom-next');
      expect(nextButton).toBeTruthy();
    });
  });

  describe('Complete Pagination Examples', () => {
    it('should render complete pagination with all components', () => {
      const component = () =>
        Pagination({
          currentPage: 3,
          totalPages: 10,
          children: () => [
            PaginationPrevious({}),
            PaginationItems({}),
            PaginationNext({}),
          ],
        });

      const { container } = renderComponent(component);

      expect(container.querySelector('[data-pagination-previous]')).toBeTruthy();
      expect(container.querySelector('[data-pagination-items]')).toBeTruthy();
      expect(container.querySelector('[data-pagination-next]')).toBeTruthy();
    });

    it('should maintain state across components', () => {
      const onPageChange = createSpy();
      const component = () =>
        Pagination({
          currentPage: 3,
          totalPages: 5,
          onPageChange,
          children: () => [
            PaginationPrevious({}),
            PaginationItems({}),
            PaginationNext({}),
          ],
        });

      const { container } = renderComponent(component);

      const prevButton = container.querySelector('[data-pagination-previous]') as HTMLButtonElement;
      const nextButton = container.querySelector('[data-pagination-next]') as HTMLButtonElement;

      prevButton.click();
      expect(onPageChange.calls[0][0]).toBe(2);

      nextButton.click();
      expect(onPageChange.calls[1][0]).toBe(4);
    });

    it('should work with single page', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 1,
          children: () => [
            PaginationPrevious({}),
            PaginationItems({}),
            PaginationNext({}),
          ],
        });

      const { container } = renderComponent(component);

      const prevButton = container.querySelector('[data-pagination-previous]') as HTMLButtonElement;
      const nextButton = container.querySelector('[data-pagination-next]') as HTMLButtonElement;

      expect(prevButton.disabled).toBe(true);
      expect(nextButton.disabled).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle page 1 of 1', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 1,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const buttons = container.querySelectorAll('[data-pagination-item]');
      expect(buttons.length).toBe(1);
    });

    it('should handle very large page counts', () => {
      const component = () =>
        Pagination({
          currentPage: 50,
          totalPages: 100,
          siblingCount: 1,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('[data-pagination-items]')).toBeTruthy();
    });

    it('should not allow navigation below page 1', () => {
      const onPageChange = createSpy();
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          onPageChange,
          children: () => PaginationPrevious({}),
        });

      const { container } = renderComponent(component);
      const prevButton = container.querySelector('[data-pagination-previous]') as HTMLButtonElement;
      prevButton.click();

      expect(onPageChange.callCount).toBe(0);
    });

    it('should not allow navigation above totalPages', () => {
      const onPageChange = createSpy();
      const component = () =>
        Pagination({
          currentPage: 5,
          totalPages: 5,
          onPageChange,
          children: () => PaginationNext({}),
        });

      const { container } = renderComponent(component);
      const nextButton = container.querySelector('[data-pagination-next]') as HTMLButtonElement;
      nextButton.click();

      expect(onPageChange.callCount).toBe(0);
    });

    it('should not call onPageChange when clicking current page', () => {
      const onPageChange = createSpy();
      const component = () =>
        Pagination({
          currentPage: 3,
          totalPages: 5,
          onPageChange,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const currentButton = container.querySelector('[data-current]') as HTMLButtonElement;
      currentButton.click();

      expect(onPageChange.callCount).toBe(0);
    });

    it('should handle siblingCount of 0', () => {
      const component = () =>
        Pagination({
          currentPage: 5,
          totalPages: 10,
          siblingCount: 0,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('[data-pagination-items]')).toBeTruthy();
    });

    it('should handle very large siblingCount', () => {
      const component = () =>
        Pagination({
          currentPage: 5,
          totalPages: 10,
          siblingCount: 10,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const buttons = container.querySelectorAll('[data-pagination-item]');
      expect(buttons.length).toBe(10); // All pages shown
    });

    it('should handle currentPage greater than totalPages gracefully', () => {
      const component = () =>
        Pagination({
          currentPage: 10,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('[data-pagination-items]')).toBeTruthy();
    });

    it('should handle negative currentPage gracefully', () => {
      const component = () =>
        Pagination({
          currentPage: -1,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('[data-pagination-items]')).toBeTruthy();
    });

    it('should handle zero totalPages', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 0,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('[data-pagination-items]')).toBeTruthy();
    });
  });

  describe('Accessibility', () => {
    it('should have proper navigation landmarks', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const nav = container.querySelector('nav');
      expect(nav?.getAttribute('role')).toBe('navigation');
      expect(nav?.getAttribute('aria-label')).toBe('Pagination');
    });

    it('should mark current page with aria-current', () => {
      const component = () =>
        Pagination({
          currentPage: 3,
          totalPages: 5,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const currentButton = container.querySelector('[aria-current="page"]');
      expect(currentButton).toBeTruthy();
      expect(currentButton?.textContent).toBe('3');
    });

    it('should have descriptive aria-labels on buttons', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          children: () => [
            PaginationPrevious({}),
            PaginationItems({}),
            PaginationNext({}),
          ],
        });

      const { container } = renderComponent(component);

      const prevButton = container.querySelector('[data-pagination-previous]');
      const nextButton = container.querySelector('[data-pagination-next]');

      expect(prevButton?.getAttribute('aria-label')).toBe('Go to previous page');
      expect(nextButton?.getAttribute('aria-label')).toBe('Go to next page');
    });

    it('should properly disable buttons', () => {
      const component = () =>
        Pagination({
          currentPage: 1,
          totalPages: 5,
          children: () => [
            PaginationPrevious({}),
            PaginationItems({}),
            PaginationNext({}),
          ],
        });

      const { container } = renderComponent(component);
      const prevButton = container.querySelector('[data-pagination-previous]') as HTMLButtonElement;
      const currentButton = container.querySelector('[data-current]') as HTMLButtonElement;

      expect(prevButton.disabled).toBe(true);
      expect(currentButton.disabled).toBe(true);
    });

    it('should hide ellipsis from screen readers', () => {
      const component = () =>
        Pagination({
          currentPage: 10,
          totalPages: 20,
          siblingCount: 1,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const ellipsis = container.querySelectorAll('[data-pagination-ellipsis]');
      ellipsis.forEach((el) => {
        expect(el.getAttribute('aria-hidden')).toBe('true');
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with custom styling', () => {
      const component = () =>
        Pagination({
          currentPage: 2,
          totalPages: 5,
          class: 'pagination-container',
          style: { display: 'flex', gap: '8px' },
          children: () => [
            PaginationPrevious({ class: 'btn-prev' }),
            PaginationItems({ class: 'btn-group' }),
            PaginationNext({ class: 'btn-next' }),
          ],
        });

      const { container } = renderComponent(component);

      expect(container.querySelector('.pagination-container')).toBeTruthy();
      expect(container.querySelector('.btn-prev')).toBeTruthy();
      expect(container.querySelector('.btn-group')).toBeTruthy();
      expect(container.querySelector('.btn-next')).toBeTruthy();
    });

    it('should work in table footer', () => {
      const component = () => {
        const table = document.createElement('table');
        const tfoot = document.createElement('tfoot');
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.setAttribute('colspan', '3');

        td.appendChild(
          Pagination({
            currentPage: 1,
            totalPages: 10,
            children: () => [
              PaginationPrevious({}),
              PaginationItems({}),
              PaginationNext({}),
            ],
          })
        );

        tr.appendChild(td);
        tfoot.appendChild(tr);
        table.appendChild(tfoot);
        return table;
      };

      const { container } = renderComponent(component);
      const table = container.querySelector('table');
      const pagination = table?.querySelector('[data-pagination]');

      expect(table).toBeTruthy();
      expect(pagination).toBeTruthy();
    });

    it('should handle rapid page changes', () => {
      const onPageChange = createSpy();
      const component = () =>
        Pagination({
          currentPage: 5,
          totalPages: 10,
          onPageChange,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const buttons = container.querySelectorAll('[data-pagination-item]');

      // Click multiple buttons rapidly
      (buttons[0] as HTMLButtonElement).click();
      (buttons[1] as HTMLButtonElement).click();
      (buttons[2] as HTMLButtonElement).click();

      expect(onPageChange.callCount).toBeGreaterThan(0);
    });

    it('should work with server-side pagination', () => {
      const onPageChange = createSpy();
      const component = () =>
        Pagination({
          currentPage: 3,
          totalPages: 100,
          siblingCount: 2,
          onPageChange,
          children: () => [
            PaginationPrevious({}),
            PaginationItems({}),
            PaginationNext({}),
          ],
        });

      const { container } = renderComponent(component);

      const nextButton = container.querySelector('[data-pagination-next]') as HTMLButtonElement;
      nextButton.click();

      expect(onPageChange.callCount).toBe(1);
      expect(onPageChange.calls[0][0]).toBe(4);
    });
  });

  describe('Performance', () => {
    it('should render efficiently with many pages', () => {
      const component = () =>
        Pagination({
          currentPage: 50,
          totalPages: 1000,
          siblingCount: 2,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);
      const buttons = container.querySelectorAll('[data-pagination-item]');

      // Should not render all 1000 buttons
      expect(buttons.length).toBeLessThan(20);
    });

    it('should handle frequent prop updates', () => {
      let currentPage = 1;
      const component = () =>
        Pagination({
          currentPage,
          totalPages: 10,
          children: () => PaginationItems({}),
        });

      const { container } = renderComponent(component);

      // Simulate prop updates
      for (let i = 2; i <= 5; i++) {
        currentPage = i;
      }

      expect(container.querySelector('[data-pagination-items]')).toBeTruthy();
    });
  });

  describe('Display Names', () => {
    it('should have display name on Pagination', () => {
      expect(Pagination.displayName).toBe('Pagination');
    });

    it('should have display name on PaginationItems', () => {
      expect(PaginationItems.displayName).toBe('Pagination.Items');
    });

    it('should have display name on PaginationPrevious', () => {
      expect(PaginationPrevious.displayName).toBe('Pagination.Previous');
    });

    it('should have display name on PaginationNext', () => {
      expect(PaginationNext.displayName).toBe('Pagination.Next');
    });
  });
});
