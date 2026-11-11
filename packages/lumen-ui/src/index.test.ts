import { describe, expect, it } from 'vitest';
import {
  ApiExplorer,
  BacklinksSection,
  CodeBlock,
  DocPagination,
  DocSectionNav,
  HoverReferenceCard,
  LumenFooter,
  LumenNavbar,
  LumenSearchDialog,
  LumenShell,
  MathTheoremBlock,
  NetronPlayground,
  PageAgentActions,
  PortalIslandHost,
} from './index.js';

describe('@omnitron-dev/lumen-ui', () => {
  it('exports component functions', () => {
    expect(typeof LumenShell).toBe('function');
    expect(typeof PortalIslandHost).toBe('function');
    expect(typeof MathTheoremBlock).toBe('function');
    expect(typeof LumenNavbar).toBe('function');
    expect(typeof LumenFooter).toBe('function');
    expect(typeof DocPagination).toBe('function');
    expect(typeof DocSectionNav).toBe('function');
    expect(typeof CodeBlock).toBe('function');
    expect(typeof HoverReferenceCard).toBe('function');
    expect(typeof ApiExplorer).toBe('function');
    expect(typeof NetronPlayground).toBe('function');
    expect(typeof BacklinksSection).toBe('function');
    expect(typeof PageAgentActions).toBe('function');
    expect(typeof LumenSearchDialog).toBe('function');
  });

  it('renders MathTheoremBlock structure with headers and attributes', () => {
    const el = MathTheoremBlock({
      id: 'thm-pythagoras',
      title: 'Pythagorean Theorem',
      envType: 'theorem',
      status: 'verified',
      children: 'a^2 + b^2 = c^2',
    });
    expect(el).toBeDefined();
    expect(el.props.id).toBe('thm-pythagoras');
    expect(el.props['data-status']).toBe('verified');
    expect(el.props.className).toContain('lumen-math-theorem');
  });

  it('renders PortalIslandHost with selective hydration data attributes', () => {
    const el = PortalIslandHost({
      islandId: 'interactive-counter',
      hydrate: 'visible',
      props: { initialCount: 42 },
    });
    expect(el.props['data-lumen-island']).toBe('interactive-counter');
    expect(el.props['data-hydrate']).toBe('visible');
    expect(JSON.parse(el.props['data-props'])).toEqual({ initialCount: 42 });
  });

  it('renders LumenShell wrapper and provider', () => {
    const shell = LumenShell({
      theme: 'light',
      locale: 'es',
      currentPath: '/docs/start',
      children: 'Content',
    });
    expect(shell).toBeDefined();
  });

  it('renders LumenNavbar and handles search dialog', () => {
    let clicked = false;
    const nav = LumenNavbar({
      title: 'Test Docs',
      items: [{ label: 'Guide', href: '/docs/guide' }],
      onSearchClick: () => {
        clicked = true;
      },
    });
    expect(nav).toBeDefined();
    expect(nav.props['aria-label']).toBe('Main navigation');
    nav.props.children[2].props.onClick();
    expect(clicked).toBe(true);

    const dialogClosed = LumenSearchDialog({ open: false });
    expect(dialogClosed).toBeNull();

    const dialogOpen = LumenSearchDialog({ open: true, onClose: () => {} });
    expect(dialogOpen).not.toBeNull();
    expect(dialogOpen?.props.role).toBe('dialog');
  });
});
