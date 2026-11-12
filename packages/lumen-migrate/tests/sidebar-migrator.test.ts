import { describe, it, expect } from 'vitest';
import { convertDocusaurusSidebars, convertSidebarItem } from '../src/docusaurus/sidebar-migrator.js';

describe('Sidebar Migrator', () => {
  it('converts shorthand string items into doc items', () => {
    expect(convertSidebarItem('intro')).toEqual({
      type: 'doc',
      id: 'intro',
    });
  });

  it('converts category items and preserves links', () => {
    const rawCategory = {
      type: 'category',
      label: 'Guides',
      link: {
        type: 'generated-index',
        slug: '/category/guides',
      },
      items: ['guides/installation', 'guides/configuration'],
    };

    const converted = convertSidebarItem(rawCategory) as any;
    expect(converted.type).toBe('category');
    expect(converted.label).toBe('Guides');
    expect(converted.href).toBe('/category/guides');
    expect(converted.items).toHaveLength(2);
    expect(converted.items[0]).toEqual({ type: 'doc', id: 'guides/installation' });
  });

  it('supports deeply nested categories (7+ levels)', () => {
    let deep: any = {
      type: 'category',
      label: 'Level 7',
      items: ['leaf'],
    };

    for (let i = 6; i >= 1; i--) {
      deep = {
        type: 'category',
        label: `Level ${i}`,
        items: [deep],
      };
    }

    const sidebars = convertDocusaurusSidebars({ docs: [deep] });
    expect(sidebars['docs']).toHaveLength(1);

    let current: any = sidebars['docs']?.[0];
    for (let i = 1; i <= 6; i++) {
      expect(current.label).toBe(`Level ${i}`);
      current = current.items[0];
    }
    expect(current.label).toBe('Level 7');
    expect(current.items[0]).toEqual({ type: 'doc', id: 'leaf' });
  });
});
