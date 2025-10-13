/**
 * Breadcrumb Component
 *
 * Navigation breadcrumbs showing the current page's location within the site hierarchy.
 *
 * @example
 * ```tsx
 * <Breadcrumb>
 *   <Breadcrumb.List>
 *     <Breadcrumb.Item>
 *       <Breadcrumb.Link href="/">Home</Breadcrumb.Link>
 *     </Breadcrumb.Item>
 *     <Breadcrumb.Separator />
 *     <Breadcrumb.Item>
 *       <Breadcrumb.Link href="/products">Products</Breadcrumb.Link>
 *     </Breadcrumb.Item>
 *     <Breadcrumb.Separator />
 *     <Breadcrumb.Item currentPage>
 *       <Breadcrumb.Page>Product Details</Breadcrumb.Page>
 *     </Breadcrumb.Item>
 *   </Breadcrumb.List>
 * </Breadcrumb>
 * ```
 */

import { jsx } from '../jsx-runtime.js';
import { defineComponent } from '../core/component/index.js';

export interface BreadcrumbProps {
  /**
   * ARIA label for the breadcrumb navigation
   */
  'aria-label'?: string;

  children?: any;
  [key: string]: any;
}

export interface BreadcrumbListProps {
  children?: any;
  [key: string]: any;
}

export interface BreadcrumbItemProps {
  /**
   * Whether this is the current page
   */
  currentPage?: boolean;

  children?: any;
  [key: string]: any;
}

export interface BreadcrumbLinkProps {
  /**
   * Link href
   */
  href?: string;

  /**
   * Whether the link is disabled
   */
  disabled?: boolean;

  /**
   * Click handler
   */
  onClick?: (e: Event) => void;

  children?: any;
  [key: string]: any;
}

export interface BreadcrumbPageProps {
  children?: any;
  [key: string]: any;
}

export interface BreadcrumbSeparatorProps {
  /**
   * Separator content (defaults to '/')
   */
  children?: any;

  [key: string]: any;
}

/**
 * Breadcrumb Root
 *
 * Container for breadcrumb navigation.
 */
export const Breadcrumb = defineComponent<BreadcrumbProps>((props) => () => {
  const { 'aria-label': ariaLabel = 'Breadcrumb', children, ...restProps } = props;

  return jsx('nav', {
    ...restProps,
    'data-breadcrumb': '',
    'aria-label': ariaLabel,
    children,
  });
});

/**
 * Breadcrumb List
 *
 * Ordered list of breadcrumb items.
 */
export const BreadcrumbList = defineComponent<BreadcrumbListProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('ol', {
    ...restProps,
    'data-breadcrumb-list': '',
    children,
  });
});

/**
 * Breadcrumb Item
 *
 * Individual breadcrumb item.
 */
export const BreadcrumbItem = defineComponent<BreadcrumbItemProps>((props) => () => {
  const { currentPage, children, ...restProps } = props;

  return jsx('li', {
    ...restProps,
    'data-breadcrumb-item': '',
    'data-current': currentPage ? '' : undefined,
    'aria-current': currentPage ? 'page' : undefined,
    children,
  });
});

/**
 * Breadcrumb Link
 *
 * Link within a breadcrumb item.
 */
export const BreadcrumbLink = defineComponent<BreadcrumbLinkProps>((props) => {
  const handleClick = (e: Event) => {
    if (props.disabled) {
      e.preventDefault();
      return;
    }
    props.onClick?.(e);
  };

  return () => {
    const { href, disabled, _onClick, children, ...restProps } = props;

    return jsx('a', {
      ...restProps,
      href: disabled ? undefined : href,
      'data-breadcrumb-link': '',
      'data-disabled': disabled ? '' : undefined,
      'aria-disabled': disabled ? 'true' : undefined,
      onClick: handleClick,
      children,
    });
  };
});

/**
 * Breadcrumb Page
 *
 * Current page text (not a link).
 */
export const BreadcrumbPage = defineComponent<BreadcrumbPageProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('span', {
    ...restProps,
    'data-breadcrumb-page': '',
    'aria-current': 'page',
    children,
  });
});

/**
 * Breadcrumb Separator
 *
 * Visual separator between breadcrumb items.
 */
export const BreadcrumbSeparator = defineComponent<BreadcrumbSeparatorProps>((props) => () => {
  const { children = '/', ...restProps } = props;

  return jsx('li', {
    ...restProps,
    'data-breadcrumb-separator': '',
    role: 'presentation',
    'aria-hidden': 'true',
    children,
  });
});

// Attach sub-components
(Breadcrumb as any).List = BreadcrumbList;
(Breadcrumb as any).Item = BreadcrumbItem;
(Breadcrumb as any).Link = BreadcrumbLink;
(Breadcrumb as any).Page = BreadcrumbPage;
(Breadcrumb as any).Separator = BreadcrumbSeparator;

// Display names
Breadcrumb.displayName = 'Breadcrumb';
BreadcrumbList.displayName = 'Breadcrumb.List';
BreadcrumbItem.displayName = 'Breadcrumb.Item';
BreadcrumbLink.displayName = 'Breadcrumb.Link';
BreadcrumbPage.displayName = 'Breadcrumb.Page';
BreadcrumbSeparator.displayName = 'Breadcrumb.Separator';
