/**
 * Breadcrumbs — the most-imported component in the design system
 * (103 call sites in the DAOS portal alone) and previously untested.
 *
 * Beyond rendering, two things matter here: the last crumb must not be a link
 * unless asked (it is the page you are on), and `moreLinks` renders raw
 * strings as anchors — so it must refuse schemes that execute.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Breadcrumbs } from './breadcrumbs.js';

describe('Breadcrumbs', () => {
  it('renders the heading and the trail', () => {
    render(
      <Breadcrumbs
        heading="Orders"
        links={[{ name: 'Dashboard', href: '/' }, { name: 'Commerce', href: '/commerce' }, { name: 'Orders' }]}
      />
    );

    expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Commerce' })).toHaveAttribute('href', '/commerce');
  });

  it('leaves the last crumb inert by default', () => {
    render(<Breadcrumbs links={[{ name: 'Dashboard', href: '/' }, { name: 'Orders', href: '/orders' }]} />);

    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument();
  });

  it('keeps the last crumb clickable when activeLast is set', () => {
    render(
      <Breadcrumbs activeLast links={[{ name: 'Dashboard', href: '/' }, { name: 'Orders', href: '/orders' }]} />
    );

    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/orders');
  });

  it('renders an action slot', () => {
    render(<Breadcrumbs heading="Orders" action={<button type="button">New order</button>} />);
    expect(screen.getByRole('button', { name: 'New order' })).toBeInTheDocument();
  });

  // --- moreLinks --------------------------------------------------------

  it('renders http(s) reference links', () => {
    render(<Breadcrumbs moreLinks={['https://example.com/docs', 'http://example.org']} />);

    expect(screen.getByRole('link', { name: 'https://example.com/docs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'http://example.org' })).toBeInTheDocument();
  });

  it('opens reference links safely in a new tab', () => {
    render(<Breadcrumbs moreLinks={['https://example.com']} />);

    const link = screen.getByRole('link', { name: 'https://example.com' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('refuses schemes that execute', () => {
    // The component takes raw strings; if any consumer ever passes one that
    // came from the server, a `javascript:` href is script execution on
    // click. A library is safe by default or it is not safe.
    render(
      <Breadcrumbs
        moreLinks={[
          // eslint-disable-next-line no-script-url
          'javascript:alert(1)',
          'data:text/html,<script>alert(1)</script>',
          'vbscript:msgbox(1)',
          'https://example.com/ok',
        ]}
      />
    );

    expect(screen.queryByText('javascript:alert(1)')).not.toBeInTheDocument();
    expect(screen.queryByText(/^data:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^vbscript:/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.com/ok' })).toBeInTheDocument();
  });

  it('allows relative and anchor references', () => {
    render(<Breadcrumbs moreLinks={['/docs/getting-started', '#section']} />);

    expect(screen.getByRole('link', { name: '/docs/getting-started' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#section' })).toBeInTheDocument();
  });
});
