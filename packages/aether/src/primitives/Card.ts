/**
 * Card Component
 *
 * A versatile container for grouping related content.
 *
 * @example
 * ```tsx
 * <Card>
 *   <Card.Header>
 *     <Card.Title>Card Title</Card.Title>
 *     <Card.Description>Card description</Card.Description>
 *   </Card.Header>
 *   <Card.Content>
 *     Main content here
 *   </Card.Content>
 *   <Card.Footer>
 *     <button>Action</button>
 *   </Card.Footer>
 * </Card>
 * ```
 */

import { jsx } from '../jsx-runtime.js';
import { defineComponent } from '../core/component/index.js';

export interface CardProps {
  /**
   * Children content
   */
  children?: any;

  /**
   * Additional HTML attributes
   */
  [key: string]: any;
}

export interface CardHeaderProps {
  children?: any;
  [key: string]: any;
}

export interface CardTitleProps {
  /**
   * Heading level (h1-h6)
   */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

  children?: any;
  [key: string]: any;
}

export interface CardDescriptionProps {
  children?: any;
  [key: string]: any;
}

export interface CardContentProps {
  children?: any;
  [key: string]: any;
}

export interface CardFooterProps {
  children?: any;
  [key: string]: any;
}

/**
 * Card Root
 *
 * Container for card content.
 */
export const Card = defineComponent<CardProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    'data-card': '',
    children,
  });
});

/**
 * Card Header
 *
 * Top section of the card, typically containing title and description.
 */
export const CardHeader = defineComponent<CardHeaderProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    'data-card-header': '',
    children,
  });
});

/**
 * Card Title
 *
 * Card heading.
 */
export const CardTitle = defineComponent<CardTitleProps>((props) => () => {
  const { as = 'h3', children, ...restProps } = props;

  return jsx(as, {
    ...restProps,
    'data-card-title': '',
    children,
  });
});

/**
 * Card Description
 *
 * Card subtitle or description.
 */
export const CardDescription = defineComponent<CardDescriptionProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('p', {
    ...restProps,
    'data-card-description': '',
    children,
  });
});

/**
 * Card Content
 *
 * Main content area of the card.
 */
export const CardContent = defineComponent<CardContentProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    'data-card-content': '',
    children,
  });
});

/**
 * Card Footer
 *
 * Bottom section of the card, typically containing actions.
 */
export const CardFooter = defineComponent<CardFooterProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    'data-card-footer': '',
    children,
  });
});

// Attach sub-components
(Card as any).Header = CardHeader;
(Card as any).Title = CardTitle;
(Card as any).Description = CardDescription;
(Card as any).Content = CardContent;
(Card as any).Footer = CardFooter;

// Display names
Card.displayName = 'Card';
CardHeader.displayName = 'Card.Header';
CardTitle.displayName = 'Card.Title';
CardDescription.displayName = 'Card.Description';
CardContent.displayName = 'Card.Content';
CardFooter.displayName = 'Card.Footer';
