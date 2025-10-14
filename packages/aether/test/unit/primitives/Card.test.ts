/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../../src/primitives/Card.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Card', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Card Root - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => Card({ children: 'Card content' });

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('div[data-card]');
      expect(cardEl).toBeTruthy();
      expect(cardEl?.textContent).toBe('Card content');
    });

    it('should render with text content', () => {
      const component = () => Card({ children: 'Simple text' });

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('[data-card]');
      expect(cardEl?.textContent).toBe('Simple text');
    });

    it('should render empty card', () => {
      const component = () => Card({});

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('[data-card]');
      expect(cardEl).toBeTruthy();
      expect(cardEl?.textContent).toBe('');
    });

    it('should render with multiple children', () => {
      const component = () => Card({ children: ['First', 'Second', 'Third'] });

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('[data-card]');
      expect(cardEl?.textContent).toContain('First');
      expect(cardEl?.textContent).toContain('Second');
      expect(cardEl?.textContent).toContain('Third');
    });

    it('should have data-card attribute', () => {
      const component = () => Card({ children: 'Test' });

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('div') as HTMLElement;
      expect(cardEl.hasAttribute('data-card')).toBe(true);
      expect(cardEl.getAttribute('data-card')).toBe('');
    });

    it('should render with HTML children', () => {
      const component = () => {
        const child = document.createElement('p');
        child.textContent = 'Paragraph content';
        return Card({ children: child });
      };

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('[data-card]');
      const paragraph = cardEl?.querySelector('p');
      expect(paragraph).toBeTruthy();
      expect(paragraph?.textContent).toBe('Paragraph content');
    });

    it('should have correct display name', () => {
      expect(Card.displayName).toBe('Card');
    });
  });

  describe('CardHeader - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => CardHeader({ children: 'Header content' });

      const { container } = renderComponent(component);

      const headerEl = container.querySelector('div[data-card-header]');
      expect(headerEl).toBeTruthy();
      expect(headerEl?.textContent).toBe('Header content');
    });

    it('should have data-card-header attribute', () => {
      const component = () => CardHeader({ children: 'Test' });

      const { container } = renderComponent(component);

      const headerEl = container.querySelector('div') as HTMLElement;
      expect(headerEl.hasAttribute('data-card-header')).toBe(true);
      expect(headerEl.getAttribute('data-card-header')).toBe('');
    });

    it('should render empty header', () => {
      const component = () => CardHeader({});

      const { container } = renderComponent(component);

      const headerEl = container.querySelector('[data-card-header]');
      expect(headerEl).toBeTruthy();
      expect(headerEl?.textContent).toBe('');
    });

    it('should have correct display name', () => {
      expect(CardHeader.displayName).toBe('Card.Header');
    });

    it('should render with multiple children', () => {
      const component = () => {
        const title = document.createElement('h3');
        title.textContent = 'Title';
        const desc = document.createElement('p');
        desc.textContent = 'Description';
        return CardHeader({ children: [title, desc] });
      };

      const { container } = renderComponent(component);

      const headerEl = container.querySelector('[data-card-header]');
      expect(headerEl?.querySelector('h3')?.textContent).toBe('Title');
      expect(headerEl?.querySelector('p')?.textContent).toBe('Description');
    });
  });

  describe('CardTitle - Basic Rendering', () => {
    it('should render as h3 element by default', () => {
      const component = () => CardTitle({ children: 'Card Title' });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('h3[data-card-title]');
      expect(titleEl).toBeTruthy();
      expect(titleEl?.textContent).toBe('Card Title');
    });

    it('should render as h1 when as="h1"', () => {
      const component = () => CardTitle({ as: 'h1', children: 'Main Title' });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('h1[data-card-title]');
      expect(titleEl).toBeTruthy();
      expect(titleEl?.textContent).toBe('Main Title');
    });

    it('should render as h2 when as="h2"', () => {
      const component = () => CardTitle({ as: 'h2', children: 'Title' });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('h2[data-card-title]');
      expect(titleEl).toBeTruthy();
    });

    it('should render as h4 when as="h4"', () => {
      const component = () => CardTitle({ as: 'h4', children: 'Title' });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('h4[data-card-title]');
      expect(titleEl).toBeTruthy();
    });

    it('should render as h5 when as="h5"', () => {
      const component = () => CardTitle({ as: 'h5', children: 'Title' });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('h5[data-card-title]');
      expect(titleEl).toBeTruthy();
    });

    it('should render as h6 when as="h6"', () => {
      const component = () => CardTitle({ as: 'h6', children: 'Title' });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('h6[data-card-title]');
      expect(titleEl).toBeTruthy();
    });

    it('should have data-card-title attribute', () => {
      const component = () => CardTitle({ children: 'Test' });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('[data-card-title]') as HTMLElement;
      expect(titleEl.hasAttribute('data-card-title')).toBe(true);
      expect(titleEl.getAttribute('data-card-title')).toBe('');
    });

    it('should have correct display name', () => {
      expect(CardTitle.displayName).toBe('Card.Title');
    });

    it('should render empty title', () => {
      const component = () => CardTitle({});

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('[data-card-title]');
      expect(titleEl).toBeTruthy();
      expect(titleEl?.textContent).toBe('');
    });
  });

  describe('CardDescription - Basic Rendering', () => {
    it('should render as a p element', () => {
      const component = () => CardDescription({ children: 'Card description' });

      const { container } = renderComponent(component);

      const descEl = container.querySelector('p[data-card-description]');
      expect(descEl).toBeTruthy();
      expect(descEl?.textContent).toBe('Card description');
    });

    it('should have data-card-description attribute', () => {
      const component = () => CardDescription({ children: 'Test' });

      const { container } = renderComponent(component);

      const descEl = container.querySelector('p') as HTMLElement;
      expect(descEl.hasAttribute('data-card-description')).toBe(true);
      expect(descEl.getAttribute('data-card-description')).toBe('');
    });

    it('should render empty description', () => {
      const component = () => CardDescription({});

      const { container } = renderComponent(component);

      const descEl = container.querySelector('[data-card-description]');
      expect(descEl).toBeTruthy();
      expect(descEl?.textContent).toBe('');
    });

    it('should have correct display name', () => {
      expect(CardDescription.displayName).toBe('Card.Description');
    });

    it('should render with long text', () => {
      const longText =
        'This is a very long description that might span multiple lines and provide detailed information about the card content';
      const component = () => CardDescription({ children: longText });

      const { container } = renderComponent(component);

      const descEl = container.querySelector('[data-card-description]');
      expect(descEl?.textContent).toBe(longText);
    });
  });

  describe('CardContent - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => CardContent({ children: 'Main content' });

      const { container } = renderComponent(component);

      const contentEl = container.querySelector('div[data-card-content]');
      expect(contentEl).toBeTruthy();
      expect(contentEl?.textContent).toBe('Main content');
    });

    it('should have data-card-content attribute', () => {
      const component = () => CardContent({ children: 'Test' });

      const { container } = renderComponent(component);

      const contentEl = container.querySelector('div') as HTMLElement;
      expect(contentEl.hasAttribute('data-card-content')).toBe(true);
      expect(contentEl.getAttribute('data-card-content')).toBe('');
    });

    it('should render empty content', () => {
      const component = () => CardContent({});

      const { container } = renderComponent(component);

      const contentEl = container.querySelector('[data-card-content]');
      expect(contentEl).toBeTruthy();
      expect(contentEl?.textContent).toBe('');
    });

    it('should have correct display name', () => {
      expect(CardContent.displayName).toBe('Card.Content');
    });

    it('should render with complex children', () => {
      const component = () => {
        const list = document.createElement('ul');
        const item1 = document.createElement('li');
        item1.textContent = 'Item 1';
        const item2 = document.createElement('li');
        item2.textContent = 'Item 2';
        list.appendChild(item1);
        list.appendChild(item2);
        return CardContent({ children: list });
      };

      const { container } = renderComponent(component);

      const contentEl = container.querySelector('[data-card-content]');
      const listEl = contentEl?.querySelector('ul');
      expect(listEl?.children.length).toBe(2);
    });
  });

  describe('CardFooter - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => CardFooter({ children: 'Footer content' });

      const { container } = renderComponent(component);

      const footerEl = container.querySelector('div[data-card-footer]');
      expect(footerEl).toBeTruthy();
      expect(footerEl?.textContent).toBe('Footer content');
    });

    it('should have data-card-footer attribute', () => {
      const component = () => CardFooter({ children: 'Test' });

      const { container } = renderComponent(component);

      const footerEl = container.querySelector('div') as HTMLElement;
      expect(footerEl.hasAttribute('data-card-footer')).toBe(true);
      expect(footerEl.getAttribute('data-card-footer')).toBe('');
    });

    it('should render empty footer', () => {
      const component = () => CardFooter({});

      const { container } = renderComponent(component);

      const footerEl = container.querySelector('[data-card-footer]');
      expect(footerEl).toBeTruthy();
      expect(footerEl?.textContent).toBe('');
    });

    it('should have correct display name', () => {
      expect(CardFooter.displayName).toBe('Card.Footer');
    });

    it('should render with button children', () => {
      const component = () => {
        const button = document.createElement('button');
        button.textContent = 'Action';
        return CardFooter({ children: button });
      };

      const { container } = renderComponent(component);

      const footerEl = container.querySelector('[data-card-footer]');
      const buttonEl = footerEl?.querySelector('button');
      expect(buttonEl?.textContent).toBe('Action');
    });
  });

  describe('Composition - Full Card Structure', () => {
    it('should render complete card with all subcomponents', () => {
      const component = () => {
        const card = Card({});
        const header = CardHeader({});
        const title = CardTitle({ children: 'Card Title' });
        const description = CardDescription({ children: 'Card description' });
        const content = CardContent({ children: 'Main content here' });
        const footer = CardFooter({});
        const button = document.createElement('button');
        button.textContent = 'Action';

        header.appendChild(title);
        header.appendChild(description);
        footer.appendChild(button);
        card.appendChild(header);
        card.appendChild(content);
        card.appendChild(footer);

        return card;
      };

      const { container } = renderComponent(component);

      expect(container.querySelector('[data-card]')).toBeTruthy();
      expect(container.querySelector('[data-card-header]')).toBeTruthy();
      expect(container.querySelector('[data-card-title]')).toBeTruthy();
      expect(container.querySelector('[data-card-description]')).toBeTruthy();
      expect(container.querySelector('[data-card-content]')).toBeTruthy();
      expect(container.querySelector('[data-card-footer]')).toBeTruthy();
    });

    it('should render card with only header and content', () => {
      const component = () => {
        const card = Card({});
        const header = CardHeader({});
        const title = CardTitle({ children: 'Title Only' });
        const content = CardContent({ children: 'Content' });

        header.appendChild(title);
        card.appendChild(header);
        card.appendChild(content);

        return card;
      };

      const { container } = renderComponent(component);

      expect(container.querySelector('[data-card-header]')).toBeTruthy();
      expect(container.querySelector('[data-card-title]')?.textContent).toBe('Title Only');
      expect(container.querySelector('[data-card-content]')?.textContent).toBe('Content');
      expect(container.querySelector('[data-card-footer]')).toBeNull();
    });

    it('should render card with only content', () => {
      const component = () => {
        const card = Card({});
        const content = CardContent({ children: 'Simple content' });
        card.appendChild(content);
        return card;
      };

      const { container } = renderComponent(component);

      expect(container.querySelector('[data-card-content]')?.textContent).toBe('Simple content');
      expect(container.querySelector('[data-card-header]')).toBeNull();
      expect(container.querySelector('[data-card-footer]')).toBeNull();
    });

    it('should allow nested cards', () => {
      const component = () => {
        const outerCard = Card({ 'data-testid': 'outer' });
        const innerCard = Card({ 'data-testid': 'inner' });
        const innerContent = CardContent({ children: 'Nested content' });
        innerCard.appendChild(innerContent);
        outerCard.appendChild(innerCard);
        return outerCard;
      };

      const { container } = renderComponent(component);

      const outerCard = container.querySelector('[data-testid="outer"]');
      const innerCard = outerCard?.querySelector('[data-testid="inner"]');
      expect(innerCard).toBeTruthy();
      expect(innerCard?.querySelector('[data-card-content]')?.textContent).toBe('Nested content');
    });
  });

  describe('Subcomponent Attachment', () => {
    it('should attach Header as Card.Header', () => {
      expect((Card as any).Header).toBe(CardHeader);
    });

    it('should attach Title as Card.Title', () => {
      expect((Card as any).Title).toBe(CardTitle);
    });

    it('should attach Description as Card.Description', () => {
      expect((Card as any).Description).toBe(CardDescription);
    });

    it('should attach Content as Card.Content', () => {
      expect((Card as any).Content).toBe(CardContent);
    });

    it('should attach Footer as Card.Footer', () => {
      expect((Card as any).Footer).toBe(CardFooter);
    });

    it('should have all subcomponents accessible', () => {
      expect((Card as any).Header).toBeTruthy();
      expect((Card as any).Title).toBeTruthy();
      expect((Card as any).Description).toBeTruthy();
      expect((Card as any).Content).toBeTruthy();
      expect((Card as any).Footer).toBeTruthy();
    });
  });

  describe('Styling', () => {
    it('should apply class name to card', () => {
      const component = () => Card({ class: 'card-primary', children: 'Content' });

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('.card-primary');
      expect(cardEl).toBeTruthy();
    });

    it('should apply inline styles to card', () => {
      const component = () =>
        Card({
          style: {
            padding: '16px',
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          },
          children: 'Styled',
        });

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('[data-card]') as HTMLElement;
      expect(cardEl.style.padding).toBe('16px');
      expect(cardEl.style.borderRadius).toBe('8px');
    });

    it('should apply class to header', () => {
      const component = () => CardHeader({ class: 'card-header-primary' });

      const { container } = renderComponent(component);

      expect(container.querySelector('.card-header-primary')).toBeTruthy();
    });

    it('should apply class to title', () => {
      const component = () => CardTitle({ class: 'title-large', children: 'Title' });

      const { container } = renderComponent(component);

      expect(container.querySelector('.title-large')).toBeTruthy();
    });

    it('should apply class to description', () => {
      const component = () => CardDescription({ class: 'text-muted', children: 'Description' });

      const { container } = renderComponent(component);

      expect(container.querySelector('.text-muted')).toBeTruthy();
    });

    it('should apply class to content', () => {
      const component = () => CardContent({ class: 'card-content-padded' });

      const { container } = renderComponent(component);

      expect(container.querySelector('.card-content-padded')).toBeTruthy();
    });

    it('should apply class to footer', () => {
      const component = () => CardFooter({ class: 'card-footer-actions' });

      const { container } = renderComponent(component);

      expect(container.querySelector('.card-footer-actions')).toBeTruthy();
    });
  });

  describe('Props Forwarding', () => {
    it('should forward id attribute to card', () => {
      const component = () => Card({ id: 'main-card', children: 'Content' });

      const { container } = renderComponent(component);

      expect(container.querySelector('#main-card')).toBeTruthy();
    });

    it('should forward data attributes to card', () => {
      const component = () =>
        Card({
          'data-testid': 'test-card',
          'data-category': 'feature',
        });

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('[data-testid="test-card"]') as HTMLElement;
      expect(cardEl).toBeTruthy();
      expect(cardEl.getAttribute('data-category')).toBe('feature');
    });

    it('should forward event handlers to card', () => {
      let clicked = false;
      const component = () =>
        Card({
          onClick: () => {
            clicked = true;
          },
          children: 'Click me',
        });

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('[data-card]') as HTMLElement;
      cardEl.click();

      expect(clicked).toBe(true);
    });

    it('should forward aria attributes to card', () => {
      const component = () =>
        Card({
          'aria-label': 'Feature card',
          'aria-describedby': 'card-desc',
        });

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('[data-card]') as HTMLElement;
      expect(cardEl.getAttribute('aria-label')).toBe('Feature card');
      expect(cardEl.getAttribute('aria-describedby')).toBe('card-desc');
    });

    it('should forward role attribute', () => {
      const component = () =>
        Card({
          role: 'article',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('[role="article"]');
      expect(cardEl).toBeTruthy();
    });
  });

  describe('Accessibility', () => {
    it('should support aria-label on card', () => {
      const component = () =>
        Card({
          'aria-label': 'Product card',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('[data-card]') as HTMLElement;
      expect(cardEl.getAttribute('aria-label')).toBe('Product card');
    });

    it('should support role="article" for semantic cards', () => {
      const component = () =>
        Card({
          role: 'article',
          children: 'Article content',
        });

      const { container } = renderComponent(component);

      expect(container.querySelector('[role="article"]')).toBeTruthy();
    });

    it('should support aria-labelledby for title association', () => {
      const component = () => {
        const card = Card({ 'aria-labelledby': 'card-title-1' });
        const header = CardHeader({});
        const title = CardTitle({ id: 'card-title-1', children: 'Title' });
        header.appendChild(title);
        card.appendChild(header);
        return card;
      };

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('[data-card]') as HTMLElement;
      expect(cardEl.getAttribute('aria-labelledby')).toBe('card-title-1');
      expect(container.querySelector('#card-title-1')).toBeTruthy();
    });

    it('should use appropriate heading level with as prop', () => {
      const component = () => CardTitle({ as: 'h2', children: 'Section Title' });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('h2');
      expect(titleEl).toBeTruthy();
      expect(titleEl?.textContent).toBe('Section Title');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined children', () => {
      const component = () => Card({ children: undefined });

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('[data-card]');
      expect(cardEl).toBeTruthy();
      expect(cardEl?.textContent).toBe('');
    });

    it('should handle null children', () => {
      const component = () => Card({ children: null });

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('[data-card]');
      expect(cardEl).toBeTruthy();
    });

    it('should handle empty array children', () => {
      const component = () => Card({ children: [] });

      const { container } = renderComponent(component);

      const cardEl = container.querySelector('[data-card]');
      expect(cardEl).toBeTruthy();
    });

    it('should handle special characters in content', () => {
      const component = () => CardTitle({ children: '<script>alert("xss")</script>' });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('[data-card-title]');
      expect(titleEl?.textContent).toBe('<script>alert("xss")</script>');
      expect(container.querySelector('script')).toBeNull();
    });

    it('should handle very long title text', () => {
      const longTitle =
        'This is a very long title that might need to be truncated or wrapped depending on the styling applied to the card';
      const component = () => CardTitle({ children: longTitle });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('[data-card-title]');
      expect(titleEl?.textContent).toBe(longTitle);
    });

    it('should handle Unicode and emoji in content', () => {
      const component = () => CardTitle({ children: '✓ Success 🎉' });

      const { container } = renderComponent(component);

      const titleEl = container.querySelector('[data-card-title]');
      expect(titleEl?.textContent).toBe('✓ Success 🎉');
    });
  });

  describe('Use Cases', () => {
    it('should work as a product card', () => {
      const component = () => {
        const card = Card({ class: 'product-card' });
        const header = CardHeader({});
        const title = CardTitle({ children: 'Product Name' });
        const content = CardContent({ children: '$99.99' });
        const footer = CardFooter({});
        const button = document.createElement('button');
        button.textContent = 'Add to Cart';

        header.appendChild(title);
        footer.appendChild(button);
        card.appendChild(header);
        card.appendChild(content);
        card.appendChild(footer);

        return card;
      };

      const { container } = renderComponent(component);

      expect(container.querySelector('.product-card')).toBeTruthy();
      expect(container.querySelector('[data-card-title]')?.textContent).toBe('Product Name');
      expect(container.querySelector('[data-card-content]')?.textContent).toBe('$99.99');
      expect(container.querySelector('button')?.textContent).toBe('Add to Cart');
    });

    it('should work as a profile card', () => {
      const component = () => {
        const card = Card({ role: 'article' });
        const header = CardHeader({});
        const title = CardTitle({ as: 'h2', children: 'John Doe' });
        const description = CardDescription({ children: 'Software Engineer' });
        const content = CardContent({ children: 'Bio information here' });

        header.appendChild(title);
        header.appendChild(description);
        card.appendChild(header);
        card.appendChild(content);

        return card;
      };

      const { container } = renderComponent(component);

      expect(container.querySelector('[role="article"]')).toBeTruthy();
      expect(container.querySelector('h2')?.textContent).toBe('John Doe');
      expect(container.querySelector('[data-card-description]')?.textContent).toBe('Software Engineer');
    });

    it('should work as a notification card', () => {
      const component = () => {
        const card = Card({ 'aria-label': 'Notification' });
        const header = CardHeader({});
        const title = CardTitle({ as: 'h4', children: 'New Message' });
        const content = CardContent({ children: 'You have a new message from Alice' });

        header.appendChild(title);
        card.appendChild(header);
        card.appendChild(content);

        return card;
      };

      const { container } = renderComponent(component);

      expect(container.querySelector('[aria-label="Notification"]')).toBeTruthy();
      expect(container.querySelector('h4')?.textContent).toBe('New Message');
    });

    it('should work as a dashboard widget card', () => {
      const component = () => {
        const card = Card({ class: 'dashboard-widget' });
        const header = CardHeader({});
        const title = CardTitle({ children: 'Total Sales' });
        const content = CardContent({ children: '$1,234,567' });

        header.appendChild(title);
        card.appendChild(header);
        card.appendChild(content);

        return card;
      };

      const { container } = renderComponent(component);

      expect(container.querySelector('.dashboard-widget')).toBeTruthy();
      expect(container.querySelector('[data-card-title]')?.textContent).toBe('Total Sales');
      expect(container.querySelector('[data-card-content]')?.textContent).toBe('$1,234,567');
    });

    it('should work with multiple action buttons in footer', () => {
      const component = () => {
        const card = Card({});
        const footer = CardFooter({ class: 'button-group' });
        const btn1 = document.createElement('button');
        btn1.textContent = 'Cancel';
        const btn2 = document.createElement('button');
        btn2.textContent = 'Save';

        footer.appendChild(btn1);
        footer.appendChild(btn2);
        card.appendChild(footer);

        return card;
      };

      const { container } = renderComponent(component);

      const footer = container.querySelector('.button-group');
      const buttons = footer?.querySelectorAll('button');
      expect(buttons?.length).toBe(2);
      expect(buttons?.[0].textContent).toBe('Cancel');
      expect(buttons?.[1].textContent).toBe('Save');
    });
  });
});
