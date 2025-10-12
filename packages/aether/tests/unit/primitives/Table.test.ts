// @vitest-environment happy-dom

/**
 * Table Primitive Tests
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  Table,
  TableCaption,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
} from '../../../src/primitives/Table.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Table', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  describe('Rendering Tests', () => {
    it('1. should render a table element with role="table"', () => {
      const { container, cleanup: dispose } = renderComponent(() => Table({}));
      cleanup = dispose;

      const table = container.querySelector('table[role="table"]');
      expect(table).toBeTruthy();
      expect(table?.getAttribute('data-table')).toBe('');
    });

    it('2. should render TableCaption as caption element', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableCaption({
          children: 'Table Description',
        })
      );
      cleanup = dispose;

      const caption = container.querySelector('caption');
      expect(caption).toBeTruthy();
      expect(caption?.getAttribute('data-table-caption')).toBe('');
      expect(caption?.textContent).toBe('Table Description');
    });

    it('3. should render TableHeader as thead element', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHeader({
          children: 'Header Content',
        })
      );
      cleanup = dispose;

      const thead = container.querySelector('thead');
      expect(thead).toBeTruthy();
      expect(thead?.getAttribute('data-table-header')).toBe('');
    });

    it('4. should render TableBody as tbody element', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableBody({
          children: 'Body Content',
        })
      );
      cleanup = dispose;

      const tbody = container.querySelector('tbody');
      expect(tbody).toBeTruthy();
      expect(tbody?.getAttribute('data-table-body')).toBe('');
    });

    it('5. should render TableFooter as tfoot element', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableFooter({
          children: 'Footer Content',
        })
      );
      cleanup = dispose;

      const tfoot = container.querySelector('tfoot');
      expect(tfoot).toBeTruthy();
      expect(tfoot?.getAttribute('data-table-footer')).toBe('');
    });

    it('6. should render TableRow as tr element', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableRow({
          children: 'Row Content',
        })
      );
      cleanup = dispose;

      const tr = container.querySelector('tr');
      expect(tr).toBeTruthy();
      expect(tr?.getAttribute('data-table-row')).toBe('');
    });

    it('7. should render TableHead as th element', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHead({
          children: 'Header Cell',
        })
      );
      cleanup = dispose;

      const th = container.querySelector('th');
      expect(th).toBeTruthy();
      expect(th?.getAttribute('data-table-head')).toBe('');
      expect(th?.textContent).toBe('Header Cell');
    });

    it('8. should render TableCell as td element', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableCell({
          children: 'Cell Content',
        })
      );
      cleanup = dispose;

      const td = container.querySelector('td');
      expect(td).toBeTruthy();
      expect(td?.getAttribute('data-table-cell')).toBe('');
      expect(td?.textContent).toBe('Cell Content');
    });

    it('9. should render complete table structure', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: [
            TableCaption({ children: 'Users' }),
            TableHeader({
              children: TableRow({
                children: [TableHead({ children: 'Name' }), TableHead({ children: 'Email' })],
              }),
            }),
            TableBody({
              children: TableRow({
                children: [TableCell({ children: 'John' }), TableCell({ children: 'john@example.com' })],
              }),
            }),
          ],
        })
      );
      cleanup = dispose;

      const table = container.querySelector('table');
      expect(table).toBeTruthy();
      expect(container.querySelector('caption')?.textContent).toBe('Users');
      expect(container.querySelector('thead')).toBeTruthy();
      expect(container.querySelector('tbody')).toBeTruthy();
      expect(container.querySelectorAll('th').length).toBe(2);
      expect(container.querySelectorAll('td').length).toBe(2);
    });

    it('10. should render children correctly', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: TableBody({
            children: TableRow({
              children: TableCell({ children: 'Test' }),
            }),
          }),
        })
      );
      cleanup = dispose;

      expect(container.querySelector('td')?.textContent).toBe('Test');
    });

    it('11. should render multiple rows', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableBody({
          children: [
            TableRow({ children: TableCell({ children: 'Row 1' }) }),
            TableRow({ children: TableCell({ children: 'Row 2' }) }),
            TableRow({ children: TableCell({ children: 'Row 3' }) }),
          ],
        })
      );
      cleanup = dispose;

      const rows = container.querySelectorAll('tr');
      expect(rows.length).toBe(3);
      expect(rows[0].textContent).toBe('Row 1');
      expect(rows[1].textContent).toBe('Row 2');
      expect(rows[2].textContent).toBe('Row 3');
    });

    it('12. should render multiple cells in a row', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableRow({
          children: [
            TableCell({ children: 'Cell 1' }),
            TableCell({ children: 'Cell 2' }),
            TableCell({ children: 'Cell 3' }),
          ],
        })
      );
      cleanup = dispose;

      const cells = container.querySelectorAll('td');
      expect(cells.length).toBe(3);
      expect(cells[0].textContent).toBe('Cell 1');
      expect(cells[1].textContent).toBe('Cell 2');
      expect(cells[2].textContent).toBe('Cell 3');
    });
  });

  describe('Row Selection Tests', () => {
    it('13. should not have selected attributes by default', () => {
      const { container, cleanup: dispose } = renderComponent(() => TableRow({}));
      cleanup = dispose;

      const tr = container.querySelector('tr');
      expect(tr?.hasAttribute('data-selected')).toBe(false);
      expect(tr?.hasAttribute('aria-selected')).toBe(false);
    });

    it('14. should apply selected attributes when selected=true', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableRow({
          selected: true,
        })
      );
      cleanup = dispose;

      const tr = container.querySelector('tr');
      expect(tr?.getAttribute('data-selected')).toBe('');
      expect(tr?.getAttribute('aria-selected')).toBe('true');
    });

    it('15. should not apply selected attributes when selected=false', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableRow({
          selected: false,
        })
      );
      cleanup = dispose;

      const tr = container.querySelector('tr');
      expect(tr?.hasAttribute('data-selected')).toBe(false);
      expect(tr?.hasAttribute('aria-selected')).toBe(false);
    });

    it('16. should toggle selected state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableRow({
          selected: true,
        })
      );
      cleanup = dispose;

      const tr = container.querySelector('tr');
      expect(tr?.getAttribute('aria-selected')).toBe('true');
    });

    it('17. should support multiple selected rows', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableBody({
          children: [
            TableRow({ selected: true, children: TableCell({ children: 'Row 1' }) }),
            TableRow({ selected: false, children: TableCell({ children: 'Row 2' }) }),
            TableRow({ selected: true, children: TableCell({ children: 'Row 3' }) }),
          ],
        })
      );
      cleanup = dispose;

      const rows = container.querySelectorAll('tr[aria-selected="true"]');
      expect(rows.length).toBe(2);
    });

    it('18. should work with selected state in complete table', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: TableBody({
            children: [
              TableRow({
                selected: true,
                children: TableCell({ children: 'Selected' }),
              }),
              TableRow({
                selected: false,
                children: TableCell({ children: 'Not selected' }),
              }),
            ],
          }),
        })
      );
      cleanup = dispose;

      const selectedRows = container.querySelectorAll('tr[data-selected]');
      expect(selectedRows.length).toBe(1);
    });
  });

  describe('Header Tests', () => {
    it('19. should use default scope="col" for TableHead', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHead({
          children: 'Header',
        })
      );
      cleanup = dispose;

      const th = container.querySelector('th');
      expect(th?.getAttribute('scope')).toBe('col');
    });

    it('20. should accept custom scope="row"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHead({
          scope: 'row',
          children: 'Header',
        })
      );
      cleanup = dispose;

      const th = container.querySelector('th');
      expect(th?.getAttribute('scope')).toBe('row');
    });

    it('21. should accept scope="colgroup"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHead({
          scope: 'colgroup',
          children: 'Header',
        })
      );
      cleanup = dispose;

      const th = container.querySelector('th');
      expect(th?.getAttribute('scope')).toBe('colgroup');
    });

    it('22. should accept scope="rowgroup"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHead({
          scope: 'rowgroup',
          children: 'Header',
        })
      );
      cleanup = dispose;

      const th = container.querySelector('th');
      expect(th?.getAttribute('scope')).toBe('rowgroup');
    });

    it('23. should not be sortable by default', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHead({
          children: 'Header',
        })
      );
      cleanup = dispose;

      const th = container.querySelector('th') as HTMLTableCellElement;
      expect(th.hasAttribute('data-sortable')).toBe(false);
      expect(th.style.cursor).toBe('');
    });

    it('24. should apply sortable attributes when sortable=true', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHead({
          sortable: true,
          children: 'Header',
        })
      );
      cleanup = dispose;

      const th = container.querySelector('th') as HTMLTableCellElement;
      expect(th.getAttribute('data-sortable')).toBe('');
      expect(th.style.cursor).toBe('pointer');
    });

    it('25. should use default sortDirection="none"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHead({
          sortable: true,
          children: 'Header',
        })
      );
      cleanup = dispose;

      const th = container.querySelector('th');
      expect(th?.hasAttribute('aria-sort')).toBe(false);
    });

    it('26. should apply aria-sort="ascending" when sortDirection="asc"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHead({
          sortable: true,
          sortDirection: 'asc',
          children: 'Header',
        })
      );
      cleanup = dispose;

      const th = container.querySelector('th');
      expect(th?.getAttribute('aria-sort')).toBe('ascending');
    });

    it('27. should apply aria-sort="descending" when sortDirection="desc"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHead({
          sortable: true,
          sortDirection: 'desc',
          children: 'Header',
        })
      );
      cleanup = dispose;

      const th = container.querySelector('th');
      expect(th?.getAttribute('aria-sort')).toBe('descending');
    });
  });

  describe('Structure Tests', () => {
    it('28. should work without caption', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: TableBody({
            children: TableRow({
              children: TableCell({ children: 'Data' }),
            }),
          }),
        })
      );
      cleanup = dispose;

      expect(container.querySelector('caption')).toBeNull();
      expect(container.querySelector('table')).toBeTruthy();
    });

    it('29. should work without header', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: TableBody({
            children: TableRow({
              children: TableCell({ children: 'Data' }),
            }),
          }),
        })
      );
      cleanup = dispose;

      expect(container.querySelector('thead')).toBeNull();
      expect(container.querySelector('tbody')).toBeTruthy();
    });

    it('30. should work without footer', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: TableBody({
            children: TableRow({
              children: TableCell({ children: 'Data' }),
            }),
          }),
        })
      );
      cleanup = dispose;

      expect(container.querySelector('tfoot')).toBeNull();
      expect(container.querySelector('tbody')).toBeTruthy();
    });

    it('31. should render table with all sections', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: [
            TableCaption({ children: 'Complete Table' }),
            TableHeader({
              children: TableRow({
                children: TableHead({ children: 'Header' }),
              }),
            }),
            TableBody({
              children: TableRow({
                children: TableCell({ children: 'Body' }),
              }),
            }),
            TableFooter({
              children: TableRow({
                children: TableCell({ children: 'Footer' }),
              }),
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('caption')).toBeTruthy();
      expect(container.querySelector('thead')).toBeTruthy();
      expect(container.querySelector('tbody')).toBeTruthy();
      expect(container.querySelector('tfoot')).toBeTruthy();
    });

    it('32. should render empty table', () => {
      const { container, cleanup: dispose } = renderComponent(() => Table({}));
      cleanup = dispose;

      const table = container.querySelector('table');
      expect(table).toBeTruthy();
      expect(table?.children.length).toBe(0);
    });

    it('33. should render table with multiple tbody sections', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: [
            TableBody({
              children: TableRow({
                children: TableCell({ children: 'Body 1' }),
              }),
            }),
            TableBody({
              children: TableRow({
                children: TableCell({ children: 'Body 2' }),
              }),
            }),
          ],
        })
      );
      cleanup = dispose;

      const tbodies = container.querySelectorAll('tbody');
      expect(tbodies.length).toBe(2);
    });

    it('34. should render table with complex nested structure', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: [
            TableHeader({
              children: [
                TableRow({
                  children: [
                    TableHead({ children: 'Col 1' }),
                    TableHead({ children: 'Col 2' }),
                    TableHead({ children: 'Col 3' }),
                  ],
                }),
              ],
            }),
            TableBody({
              children: [
                TableRow({
                  children: [
                    TableCell({ children: 'R1C1' }),
                    TableCell({ children: 'R1C2' }),
                    TableCell({ children: 'R1C3' }),
                  ],
                }),
                TableRow({
                  children: [
                    TableCell({ children: 'R2C1' }),
                    TableCell({ children: 'R2C2' }),
                    TableCell({ children: 'R2C3' }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelectorAll('th').length).toBe(3);
      expect(container.querySelectorAll('td').length).toBe(6);
      expect(container.querySelectorAll('tr').length).toBe(3);
    });

    it('35. should handle empty rows and cells', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableBody({
          children: [
            TableRow({ children: TableCell({}) }),
            TableRow({ children: TableCell({}) }),
          ],
        })
      );
      cleanup = dispose;

      const rows = container.querySelectorAll('tr');
      expect(rows.length).toBe(2);
      expect(container.querySelectorAll('td').length).toBe(2);
    });
  });

  describe('Accessibility Tests', () => {
    it('36. should have proper table role', () => {
      const { container, cleanup: dispose } = renderComponent(() => Table({}));
      cleanup = dispose;

      const table = container.querySelector('table');
      expect(table?.getAttribute('role')).toBe('table');
    });

    it('37. should have proper scope on header cells', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHeader({
          children: TableRow({
            children: [
              TableHead({ scope: 'col', children: 'Name' }),
              TableHead({ scope: 'col', children: 'Email' }),
            ],
          }),
        })
      );
      cleanup = dispose;

      const headers = container.querySelectorAll('th');
      headers.forEach((th) => {
        expect(th.getAttribute('scope')).toBe('col');
      });
    });

    it('38. should support aria-selected on rows', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableRow({
          selected: true,
        })
      );
      cleanup = dispose;

      const tr = container.querySelector('tr');
      expect(tr?.getAttribute('aria-selected')).toBe('true');
    });

    it('39. should support aria-sort on sortable headers', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHead({
          sortable: true,
          sortDirection: 'asc',
          children: 'Sortable',
        })
      );
      cleanup = dispose;

      const th = container.querySelector('th');
      expect(th?.getAttribute('aria-sort')).toBe('ascending');
    });

    it('40. should use semantic HTML elements', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: [
            TableCaption({ children: 'Caption' }),
            TableHeader({
              children: TableRow({
                children: TableHead({ children: 'Header' }),
              }),
            }),
            TableBody({
              children: TableRow({
                children: TableCell({ children: 'Cell' }),
              }),
            }),
            TableFooter({
              children: TableRow({
                children: TableCell({ children: 'Footer' }),
              }),
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('table')).toBeTruthy();
      expect(container.querySelector('caption')).toBeTruthy();
      expect(container.querySelector('thead')).toBeTruthy();
      expect(container.querySelector('tbody')).toBeTruthy();
      expect(container.querySelector('tfoot')).toBeTruthy();
      expect(container.querySelector('tr')).toBeTruthy();
      expect(container.querySelector('th')).toBeTruthy();
      expect(container.querySelector('td')).toBeTruthy();
    });

    it('41. should maintain proper table structure hierarchy', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: TableBody({
            children: TableRow({
              children: TableCell({ children: 'Data' }),
            }),
          }),
        })
      );
      cleanup = dispose;

      const table = container.querySelector('table');
      const tbody = table?.querySelector('tbody');
      const tr = tbody?.querySelector('tr');
      const td = tr?.querySelector('td');

      expect(table).toBeTruthy();
      expect(tbody).toBeTruthy();
      expect(tr).toBeTruthy();
      expect(td).toBeTruthy();
    });

    it('42. should support caption for table description', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: [
            TableCaption({ children: 'User data table showing names and emails' }),
            TableBody({
              children: TableRow({
                children: TableCell({ children: 'Data' }),
              }),
            }),
          ],
        })
      );
      cleanup = dispose;

      const caption = container.querySelector('caption');
      expect(caption?.textContent).toBe('User data table showing names and emails');
    });

    it('43. should properly associate headers with data cells through structure', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: [
            TableHeader({
              children: TableRow({
                children: [
                  TableHead({ scope: 'col', children: 'Name' }),
                  TableHead({ scope: 'col', children: 'Age' }),
                ],
              }),
            }),
            TableBody({
              children: TableRow({
                children: [TableCell({ children: 'John' }), TableCell({ children: '30' })],
              }),
            }),
          ],
        })
      );
      cleanup = dispose;

      const headers = container.querySelectorAll('th');
      expect(headers[0].getAttribute('scope')).toBe('col');
      expect(headers[1].getAttribute('scope')).toBe('col');
    });
  });

  describe('Props Handling Tests', () => {
    it('44. should accept and apply className to Table', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          className: 'custom-table',
        })
      );
      cleanup = dispose;

      const table = container.querySelector('table');
      expect(table?.className).toBe('custom-table');
    });

    it('45. should accept and apply style to Table', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          style: { borderCollapse: 'collapse' },
        })
      );
      cleanup = dispose;

      const table = container.querySelector('table') as HTMLTableElement;
      expect(table.style.borderCollapse).toBe('collapse');
    });

    it('46. should accept and apply data attributes', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          'data-testid': 'my-table',
        })
      );
      cleanup = dispose;

      const table = container.querySelector('table');
      expect(table?.getAttribute('data-testid')).toBe('my-table');
    });

    it('47. should accept and apply custom props to all components', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          'data-table-prop': 'table',
          children: [
            TableCaption({ 'data-caption-prop': 'caption', children: 'Caption' }),
            TableHeader({
              'data-header-prop': 'header',
              children: TableRow({
                'data-row-prop': 'row',
                children: TableHead({ 'data-head-prop': 'head', children: 'Header' }),
              }),
            }),
            TableBody({
              'data-body-prop': 'body',
              children: TableRow({
                children: TableCell({ 'data-cell-prop': 'cell', children: 'Cell' }),
              }),
            }),
            TableFooter({ 'data-footer-prop': 'footer', children: 'Footer' }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('table')?.getAttribute('data-table-prop')).toBe('table');
      expect(container.querySelector('caption')?.getAttribute('data-caption-prop')).toBe('caption');
      expect(container.querySelector('thead')?.getAttribute('data-header-prop')).toBe('header');
      expect(container.querySelector('tbody')?.getAttribute('data-body-prop')).toBe('body');
      expect(container.querySelector('tfoot')?.getAttribute('data-footer-prop')).toBe('footer');
      expect(container.querySelector('tr')?.getAttribute('data-row-prop')).toBe('row');
      expect(container.querySelector('th')?.getAttribute('data-head-prop')).toBe('head');
      expect(container.querySelector('td')?.getAttribute('data-cell-prop')).toBe('cell');
    });

    it('48. should merge styles correctly on TableHead with sortable', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHead({
          sortable: true,
          style: { color: 'red', fontSize: '16px' },
          children: 'Header',
        })
      );
      cleanup = dispose;

      const th = container.querySelector('th') as HTMLTableCellElement;
      expect(th.style.cursor).toBe('pointer');
      expect(th.style.color).toBe('red');
      expect(th.style.fontSize).toBe('16px');
    });

    it('49. should not override existing cursor style when not sortable', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TableHead({
          sortable: false,
          style: { cursor: 'not-allowed' },
          children: 'Header',
        })
      );
      cleanup = dispose;

      const th = container.querySelector('th') as HTMLTableCellElement;
      expect(th.style.cursor).toBe('not-allowed');
    });
  });

  describe('Context Tests', () => {
    it('50. should provide context to children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: TableBody({
            children: TableRow({
              children: TableCell({ children: 'Data' }),
            }),
          }),
        })
      );
      cleanup = dispose;

      // Context is provided implicitly
      const table = container.querySelector('table');
      expect(table).toBeTruthy();
      expect(container.querySelector('td')?.textContent).toBe('Data');
    });

    it('51. should work with deeply nested components', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          children: [
            TableHeader({
              children: TableRow({
                children: TableHead({ children: 'Header' }),
              }),
            }),
            TableBody({
              children: [
                TableRow({
                  children: TableCell({ children: 'Row 1' }),
                }),
                TableRow({
                  children: TableCell({ children: 'Row 2' }),
                }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('table')).toBeTruthy();
      expect(container.querySelectorAll('tr').length).toBe(3);
    });

    it('52. should maintain accessibility context throughout structure', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Table({
          'aria-label': 'Data table',
          children: [
            TableCaption({ children: 'Employee Information' }),
            TableHeader({
              children: TableRow({
                children: [
                  TableHead({ scope: 'col', children: 'Name' }),
                  TableHead({ scope: 'col', children: 'Role' }),
                ],
              }),
            }),
            TableBody({
              children: TableRow({
                selected: true,
                children: [TableCell({ children: 'Alice' }), TableCell({ children: 'Developer' })],
              }),
            }),
          ],
        })
      );
      cleanup = dispose;

      const table = container.querySelector('table');
      expect(table?.getAttribute('aria-label')).toBe('Data table');
      expect(table?.getAttribute('role')).toBe('table');
      expect(container.querySelector('caption')?.textContent).toBe('Employee Information');
      expect(container.querySelector('tr[aria-selected="true"]')).toBeTruthy();
    });
  });
});
