/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Timeline,
  TimelineItem,
  TimelineMarker,
  TimelineConnector,
  TimelineContent,
  TimelineTitle,
  TimelineDescription,
  TimelineTimestamp,
} from '../../../src/primitives/Timeline.js';
import { renderComponent, nextTick } from '../../helpers/test-utils.js';

describe('Timeline', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Timeline Root - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => Timeline({ children: 'Timeline' });
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('div[data-timeline]');
      expect(timelineEl).toBeTruthy();
    });

    it('should have data-timeline attribute', () => {
      const component = () => Timeline({});
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('[data-timeline]');
      expect(timelineEl).toBeTruthy();
      expect(timelineEl?.hasAttribute('data-timeline')).toBe(true);
    });

    it('should have role="list"', () => {
      const component = () => Timeline({});
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('[role="list"]');
      expect(timelineEl).toBeTruthy();
    });

    it('should render with children', () => {
      const component = () => Timeline({ children: 'Timeline content' });
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('[data-timeline]');
      expect(timelineEl?.textContent).toContain('Timeline content');
    });

    it('should render without children', () => {
      const component = () => Timeline({});
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('[data-timeline]');
      expect(timelineEl).toBeTruthy();
    });
  });

  describe('Timeline Root - Orientation', () => {
    it('should default to vertical orientation', () => {
      const component = () => Timeline({});
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('[data-timeline]') as HTMLElement;
      expect(timelineEl.getAttribute('data-orientation')).toBe('vertical');
    });

    it('should support vertical orientation', () => {
      const component = () => Timeline({ orientation: 'vertical' });
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('[data-timeline]') as HTMLElement;
      expect(timelineEl.getAttribute('data-orientation')).toBe('vertical');
    });

    it('should support horizontal orientation', () => {
      const component = () => Timeline({ orientation: 'horizontal' });
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('[data-timeline]') as HTMLElement;
      expect(timelineEl.getAttribute('data-orientation')).toBe('horizontal');
    });
  });

  describe('Timeline Root - Props Forwarding', () => {
    it('should forward id attribute', () => {
      const component = () => Timeline({ id: 'my-timeline' });
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('#my-timeline');
      expect(timelineEl).toBeTruthy();
    });

    it('should forward class attribute', () => {
      const component = () => Timeline({ class: 'custom-timeline' });
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('.custom-timeline');
      expect(timelineEl).toBeTruthy();
    });

    it('should forward style attribute', () => {
      const component = () => Timeline({ style: { padding: '20px' } });
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('[data-timeline]') as HTMLElement;
      expect(timelineEl.style.padding).toBe('20px');
    });

    it('should forward data attributes', () => {
      const component = () => Timeline({ 'data-testid': 'timeline-test' });
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('[data-testid="timeline-test"]');
      expect(timelineEl).toBeTruthy();
    });

    it('should forward aria attributes', () => {
      const component = () => Timeline({ 'aria-label': 'Activity timeline' });
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('[data-timeline]') as HTMLElement;
      expect(timelineEl.getAttribute('aria-label')).toBe('Activity timeline');
    });
  });

  describe('TimelineItem - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({ children: 'Item' }),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[data-timeline-item]');
      expect(itemEl).toBeTruthy();
    });

    it('should have data-timeline-item attribute', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({}),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[data-timeline-item]');
      expect(itemEl?.hasAttribute('data-timeline-item')).toBe(true);
    });

    it('should have role="listitem"', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({}),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[role="listitem"]');
      expect(itemEl).toBeTruthy();
    });

    it('should render with children', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({ children: 'Timeline item content' }),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[data-timeline-item]');
      expect(itemEl?.textContent).toContain('Timeline item content');
    });

    it('should use default context when used outside Timeline', () => {
      // Timeline components use defaultValue (null) when no parent context
      // This is an architectural choice in Aether - components gracefully degrade
      const component = () => TimelineItem({});
      const { container } = renderComponent(component);
      const itemEl = container.querySelector('[data-timeline-item]');
      // Component renders but uses null context (no orientation from parent)
      expect(itemEl).toBeTruthy();
    });
  });

  describe('TimelineItem - Status', () => {
    it('should default to pending status', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({}),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[data-timeline-item]') as HTMLElement;
      expect(itemEl.getAttribute('data-status')).toBe('pending');
    });

    it('should support pending status', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({ status: 'pending' }),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[data-timeline-item]') as HTMLElement;
      expect(itemEl.getAttribute('data-status')).toBe('pending');
    });

    it('should support active status', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({ status: 'active' }),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[data-timeline-item]') as HTMLElement;
      expect(itemEl.getAttribute('data-status')).toBe('active');
    });

    it('should support completed status', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({ status: 'completed' }),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[data-timeline-item]') as HTMLElement;
      expect(itemEl.getAttribute('data-status')).toBe('completed');
    });

    it('should support error status', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({ status: 'error' }),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[data-timeline-item]') as HTMLElement;
      expect(itemEl.getAttribute('data-status')).toBe('error');
    });
  });

  describe('TimelineItem - Orientation Inheritance', () => {
    it('should inherit vertical orientation from Timeline', () => {
      const component = () =>
        Timeline({
          orientation: 'vertical',
          children: () => TimelineItem({}),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[data-timeline-item]') as HTMLElement;
      expect(itemEl.getAttribute('data-orientation')).toBe('vertical');
    });

    it('should inherit horizontal orientation from Timeline', () => {
      const component = () =>
        Timeline({
          orientation: 'horizontal',
          children: () => TimelineItem({}),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[data-timeline-item]') as HTMLElement;
      expect(itemEl.getAttribute('data-orientation')).toBe('horizontal');
    });
  });

  describe('TimelineItem - Props Forwarding', () => {
    it('should forward class attribute', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({ class: 'custom-item' }),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('.custom-item');
      expect(itemEl).toBeTruthy();
    });

    it('should forward data attributes', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({ 'data-testid': 'item-test' }),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[data-testid="item-test"]');
      expect(itemEl).toBeTruthy();
    });
  });

  describe('TimelineMarker - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            children: () => TimelineMarker({}),
          }),
        });
      const { container } = renderComponent(component);

      const markerEl = container.querySelector('[data-timeline-marker]');
      expect(markerEl).toBeTruthy();
    });

    it('should have data-timeline-marker attribute', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            children: () => TimelineMarker({}),
          }),
        });
      const { container } = renderComponent(component);

      const markerEl = container.querySelector('[data-timeline-marker]');
      expect(markerEl?.hasAttribute('data-timeline-marker')).toBe(true);
    });

    it('should have aria-hidden="true"', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            children: () => TimelineMarker({}),
          }),
        });
      const { container } = renderComponent(component);

      const markerEl = container.querySelector('[data-timeline-marker]') as HTMLElement;
      expect(markerEl.getAttribute('aria-hidden')).toBe('true');
    });

    it('should render default dot marker when no children', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            children: () => TimelineMarker({}),
          }),
        });
      const { container } = renderComponent(component);

      const dotEl = container.querySelector('[data-timeline-marker-dot]');
      expect(dotEl).toBeTruthy();
    });

    it('should render custom children', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            children: () => TimelineMarker({ children: 'X' }),
          }),
        });
      const { container } = renderComponent(component);

      const markerEl = container.querySelector('[data-timeline-marker]');
      expect(markerEl?.textContent).toBe('X');
    });

    it('should not render default dot when custom children provided', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            children: () => TimelineMarker({ children: 'Icon' }),
          }),
        });
      const { container } = renderComponent(component);

      const dotEl = container.querySelector('[data-timeline-marker-dot]');
      expect(dotEl).toBeNull();
    });

    it('should use default context when used outside TimelineItem', () => {
      // TimelineMarker gracefully degrades when no parent context
      const component = () => TimelineMarker({});
      const { container } = renderComponent(component);
      const markerEl = container.querySelector('[data-timeline-marker]');
      // Component renders but uses null context (no status from parent)
      expect(markerEl).toBeTruthy();
    });
  });

  describe('TimelineMarker - Status Inheritance', () => {
    it('should inherit pending status from TimelineItem', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            status: 'pending',
            children: () => TimelineMarker({}),
          }),
        });
      const { container } = renderComponent(component);

      const markerEl = container.querySelector('[data-timeline-marker]') as HTMLElement;
      expect(markerEl.getAttribute('data-status')).toBe('pending');
    });

    it('should inherit active status from TimelineItem', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            status: 'active',
            children: () => TimelineMarker({}),
          }),
        });
      const { container } = renderComponent(component);

      const markerEl = container.querySelector('[data-timeline-marker]') as HTMLElement;
      expect(markerEl.getAttribute('data-status')).toBe('active');
    });

    it('should inherit completed status from TimelineItem', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            status: 'completed',
            children: () => TimelineMarker({}),
          }),
        });
      const { container } = renderComponent(component);

      const markerEl = container.querySelector('[data-timeline-marker]') as HTMLElement;
      expect(markerEl.getAttribute('data-status')).toBe('completed');
    });

    it('should inherit error status from TimelineItem', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            status: 'error',
            children: () => TimelineMarker({}),
          }),
        });
      const { container } = renderComponent(component);

      const markerEl = container.querySelector('[data-timeline-marker]') as HTMLElement;
      expect(markerEl.getAttribute('data-status')).toBe('error');
    });
  });

  describe('TimelineConnector - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            children: () => TimelineConnector({}),
          }),
        });
      const { container } = renderComponent(component);

      const connectorEl = container.querySelector('[data-timeline-connector]');
      expect(connectorEl).toBeTruthy();
    });

    it('should have data-timeline-connector attribute', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            children: () => TimelineConnector({}),
          }),
        });
      const { container } = renderComponent(component);

      const connectorEl = container.querySelector('[data-timeline-connector]');
      expect(connectorEl?.hasAttribute('data-timeline-connector')).toBe(true);
    });

    it('should have aria-hidden="true"', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            children: () => TimelineConnector({}),
          }),
        });
      const { container } = renderComponent(component);

      const connectorEl = container.querySelector('[data-timeline-connector]') as HTMLElement;
      expect(connectorEl.getAttribute('aria-hidden')).toBe('true');
    });

    it('should use default context when used outside TimelineItem', () => {
      // TimelineConnector gracefully degrades when no parent context
      const component = () => TimelineConnector({});
      const { container } = renderComponent(component);
      const connectorEl = container.querySelector('[data-timeline-connector]');
      // Component renders but uses null context (no status from parent)
      expect(connectorEl).toBeTruthy();
    });
  });

  describe('TimelineConnector - Status Inheritance', () => {
    it('should inherit pending status from TimelineItem', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            status: 'pending',
            children: () => TimelineConnector({}),
          }),
        });
      const { container } = renderComponent(component);

      const connectorEl = container.querySelector('[data-timeline-connector]') as HTMLElement;
      expect(connectorEl.getAttribute('data-status')).toBe('pending');
    });

    it('should inherit active status from TimelineItem', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            status: 'active',
            children: () => TimelineConnector({}),
          }),
        });
      const { container } = renderComponent(component);

      const connectorEl = container.querySelector('[data-timeline-connector]') as HTMLElement;
      expect(connectorEl.getAttribute('data-status')).toBe('active');
    });

    it('should inherit completed status from TimelineItem', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            status: 'completed',
            children: () => TimelineConnector({}),
          }),
        });
      const { container } = renderComponent(component);

      const connectorEl = container.querySelector('[data-timeline-connector]') as HTMLElement;
      expect(connectorEl.getAttribute('data-status')).toBe('completed');
    });

    it('should inherit error status from TimelineItem', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            status: 'error',
            children: () => TimelineConnector({}),
          }),
        });
      const { container } = renderComponent(component);

      const connectorEl = container.querySelector('[data-timeline-connector]') as HTMLElement;
      expect(connectorEl.getAttribute('data-status')).toBe('error');
    });
  });

  describe('TimelineContent - Basic Rendering', () => {
    it('should render as a div element', () => {
      const component = () => TimelineContent({ children: 'Content' });
      const { container } = renderComponent(component);

      const contentEl = container.querySelector('[data-timeline-content]');
      expect(contentEl).toBeTruthy();
    });

    it('should have data-timeline-content attribute', () => {
      const component = () => TimelineContent({});
      const { container } = renderComponent(component);

      const contentEl = container.querySelector('[data-timeline-content]');
      expect(contentEl?.hasAttribute('data-timeline-content')).toBe(true);
    });

    it('should render with children', () => {
      const component = () => TimelineContent({ children: 'Timeline content' });
      const { container } = renderComponent(component);

      const contentEl = container.querySelector('[data-timeline-content]');
      expect(contentEl?.textContent).toBe('Timeline content');
    });

    it('should forward class attribute', () => {
      const component = () => TimelineContent({ class: 'custom-content' });
      const { container } = renderComponent(component);

      const contentEl = container.querySelector('.custom-content');
      expect(contentEl).toBeTruthy();
    });
  });

  describe('TimelineTitle - Basic Rendering', () => {
    it('should render as an h4 element', () => {
      const component = () => TimelineTitle({ children: 'Title' });
      const { container } = renderComponent(component);

      const titleEl = container.querySelector('h4');
      expect(titleEl).toBeTruthy();
    });

    it('should have data-timeline-title attribute', () => {
      const component = () => TimelineTitle({ children: 'Title' });
      const { container } = renderComponent(component);

      const titleEl = container.querySelector('[data-timeline-title]');
      expect(titleEl?.hasAttribute('data-timeline-title')).toBe(true);
    });

    it('should render with children', () => {
      const component = () => TimelineTitle({ children: 'Event Title' });
      const { container } = renderComponent(component);

      const titleEl = container.querySelector('h4');
      expect(titleEl?.textContent).toBe('Event Title');
    });

    it('should forward class attribute', () => {
      const component = () => TimelineTitle({ class: 'custom-title', children: 'Title' });
      const { container } = renderComponent(component);

      const titleEl = container.querySelector('.custom-title');
      expect(titleEl).toBeTruthy();
    });
  });

  describe('TimelineDescription - Basic Rendering', () => {
    it('should render as a p element', () => {
      const component = () => TimelineDescription({ children: 'Description' });
      const { container } = renderComponent(component);

      const descEl = container.querySelector('p');
      expect(descEl).toBeTruthy();
    });

    it('should have data-timeline-description attribute', () => {
      const component = () => TimelineDescription({ children: 'Description' });
      const { container } = renderComponent(component);

      const descEl = container.querySelector('[data-timeline-description]');
      expect(descEl?.hasAttribute('data-timeline-description')).toBe(true);
    });

    it('should render with children', () => {
      const component = () => TimelineDescription({ children: 'Event description text' });
      const { container } = renderComponent(component);

      const descEl = container.querySelector('p');
      expect(descEl?.textContent).toBe('Event description text');
    });

    it('should forward class attribute', () => {
      const component = () =>
        TimelineDescription({ class: 'custom-desc', children: 'Description' });
      const { container } = renderComponent(component);

      const descEl = container.querySelector('.custom-desc');
      expect(descEl).toBeTruthy();
    });
  });

  describe('TimelineTimestamp - Basic Rendering', () => {
    it('should render as a time element', () => {
      const component = () => TimelineTimestamp({ children: '2024-01-01' });
      const { container } = renderComponent(component);

      const timeEl = container.querySelector('time');
      expect(timeEl).toBeTruthy();
    });

    it('should have data-timeline-timestamp attribute', () => {
      const component = () => TimelineTimestamp({ children: '2024-01-01' });
      const { container } = renderComponent(component);

      const timeEl = container.querySelector('[data-timeline-timestamp]');
      expect(timeEl?.hasAttribute('data-timeline-timestamp')).toBe(true);
    });

    it('should render with children', () => {
      const component = () => TimelineTimestamp({ children: '2 hours ago' });
      const { container } = renderComponent(component);

      const timeEl = container.querySelector('time');
      expect(timeEl?.textContent).toBe('2 hours ago');
    });

    it('should support datetime attribute', () => {
      const component = () =>
        TimelineTimestamp({
          datetime: '2024-01-01T12:00:00Z',
          children: 'January 1, 2024',
        });
      const { container } = renderComponent(component);

      const timeEl = container.querySelector('time') as HTMLElement;
      expect(timeEl.getAttribute('datetime')).toBe('2024-01-01T12:00:00Z');
      expect(timeEl.textContent).toBe('January 1, 2024');
    });

    it('should forward class attribute', () => {
      const component = () =>
        TimelineTimestamp({ class: 'custom-time', children: '2024-01-01' });
      const { container } = renderComponent(component);

      const timeEl = container.querySelector('.custom-time');
      expect(timeEl).toBeTruthy();
    });
  });

  describe('Sub-component Attachments', () => {
    it('should have Item attached to Timeline', () => {
      expect((Timeline as any).Item).toBe(TimelineItem);
    });

    it('should have Marker attached to Timeline', () => {
      expect((Timeline as any).Marker).toBe(TimelineMarker);
    });

    it('should have Connector attached to Timeline', () => {
      expect((Timeline as any).Connector).toBe(TimelineConnector);
    });

    it('should have Content attached to Timeline', () => {
      expect((Timeline as any).Content).toBe(TimelineContent);
    });

    it('should have Title attached to Timeline', () => {
      expect((Timeline as any).Title).toBe(TimelineTitle);
    });

    it('should have Description attached to Timeline', () => {
      expect((Timeline as any).Description).toBe(TimelineDescription);
    });

    it('should have Timestamp attached to Timeline', () => {
      expect((Timeline as any).Timestamp).toBe(TimelineTimestamp);
    });
  });

  describe('Complete Timeline Structure', () => {
    it('should render a complete timeline with all parts', () => {
      const component = () =>
        Timeline({
          children: () => [
            TimelineItem({
              status: 'completed',
              children: () => [
                TimelineMarker({}),
                TimelineConnector({}),
                TimelineContent({
                  children: () => [
                    TimelineTitle({ children: 'Event 1' }),
                    TimelineDescription({ children: 'First event' }),
                    TimelineTimestamp({ children: '1 hour ago' }),
                  ],
                }),
              ],
            }),
          ],
        });
      const { container } = renderComponent(component);

      expect(container.querySelector('[data-timeline]')).toBeTruthy();
      expect(container.querySelector('[data-timeline-item]')).toBeTruthy();
      expect(container.querySelector('[data-timeline-marker]')).toBeTruthy();
      expect(container.querySelector('[data-timeline-connector]')).toBeTruthy();
      expect(container.querySelector('[data-timeline-content]')).toBeTruthy();
      expect(container.querySelector('[data-timeline-title]')).toBeTruthy();
      expect(container.querySelector('[data-timeline-description]')).toBeTruthy();
      expect(container.querySelector('[data-timeline-timestamp]')).toBeTruthy();
    });

    it('should render multiple timeline items', () => {
      const component = () =>
        Timeline({
          children: () => [
            TimelineItem({ status: 'completed', children: () => TimelineMarker({}) }),
            TimelineItem({ status: 'active', children: () => TimelineMarker({}) }),
            TimelineItem({ status: 'pending', children: () => TimelineMarker({}) }),
          ],
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-timeline-item]');
      expect(items.length).toBe(3);
      expect((items[0] as HTMLElement).getAttribute('data-status')).toBe('completed');
      expect((items[1] as HTMLElement).getAttribute('data-status')).toBe('active');
      expect((items[2] as HTMLElement).getAttribute('data-status')).toBe('pending');
    });

    it('should render timeline with custom markers', () => {
      const component = () =>
        Timeline({
          children: () => [
            TimelineItem({
              children: () => TimelineMarker({ children: '✓' }),
            }),
            TimelineItem({
              children: () => TimelineMarker({ children: '✗' }),
            }),
          ],
        });
      const { container } = renderComponent(component);

      const markers = container.querySelectorAll('[data-timeline-marker]');
      expect(markers[0]?.textContent).toBe('✓');
      expect(markers[1]?.textContent).toBe('✗');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty timeline', () => {
      const component = () => Timeline({});
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('[data-timeline]');
      expect(timelineEl).toBeTruthy();
    });

    it('should handle timeline with undefined children', () => {
      const component = () => Timeline({ children: undefined });
      const { container } = renderComponent(component);

      const timelineEl = container.querySelector('[data-timeline]');
      expect(timelineEl).toBeTruthy();
    });

    it('should handle timeline item with undefined children', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({ children: undefined }),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[data-timeline-item]');
      expect(itemEl).toBeTruthy();
    });

    it('should handle marker with empty string', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            children: () => TimelineMarker({ children: '' }),
          }),
        });
      const { container } = renderComponent(component);

      const markerEl = container.querySelector('[data-timeline-marker]');
      expect(markerEl).toBeTruthy();
    });

    it('should handle content with null children', () => {
      const component = () => TimelineContent({ children: null });
      const { container } = renderComponent(component);

      const contentEl = container.querySelector('[data-timeline-content]');
      expect(contentEl).toBeTruthy();
    });

    it('should handle title with special characters', () => {
      const component = () => TimelineTitle({ children: '<script>alert("xss")</script>' });
      const { container } = renderComponent(component);

      const titleEl = container.querySelector('h4');
      expect(titleEl?.textContent).toBe('<script>alert("xss")</script>');
      expect(container.querySelector('script')).toBeNull();
    });

    it('should handle description with very long text', () => {
      const longText = 'A'.repeat(1000);
      const component = () => TimelineDescription({ children: longText });
      const { container } = renderComponent(component);

      const descEl = container.querySelector('p');
      expect(descEl?.textContent).toBe(longText);
    });

    it('should handle timestamp with Unicode characters', () => {
      const component = () => TimelineTimestamp({ children: '✓ Completed' });
      const { container } = renderComponent(component);

      const timeEl = container.querySelector('time');
      expect(timeEl?.textContent).toBe('✓ Completed');
    });
  });

  describe('Use Cases', () => {
    it('should work as activity feed', () => {
      const component = () =>
        Timeline({
          children: () => [
            TimelineItem({
              status: 'completed',
              children: () => [
                TimelineMarker({}),
                TimelineContent({
                  children: () => [
                    TimelineTitle({ children: 'User logged in' }),
                    TimelineTimestamp({ children: '5 minutes ago' }),
                  ],
                }),
              ],
            }),
            TimelineItem({
              status: 'completed',
              children: () => [
                TimelineMarker({}),
                TimelineContent({
                  children: () => [
                    TimelineTitle({ children: 'Profile updated' }),
                    TimelineTimestamp({ children: '10 minutes ago' }),
                  ],
                }),
              ],
            }),
          ],
        });
      const { container } = renderComponent(component);

      const titles = container.querySelectorAll('[data-timeline-title]');
      expect(titles.length).toBe(2);
      expect(titles[0]?.textContent).toBe('User logged in');
      expect(titles[1]?.textContent).toBe('Profile updated');
    });

    it('should work as stepper/progress indicator', () => {
      const component = () =>
        Timeline({
          orientation: 'horizontal',
          children: () => [
            TimelineItem({
              status: 'completed',
              children: () => [
                TimelineMarker({ children: '1' }),
                TimelineContent({ children: 'Step 1' }),
              ],
            }),
            TimelineItem({
              status: 'active',
              children: () => [
                TimelineMarker({ children: '2' }),
                TimelineContent({ children: 'Step 2' }),
              ],
            }),
            TimelineItem({
              status: 'pending',
              children: () => [
                TimelineMarker({ children: '3' }),
                TimelineContent({ children: 'Step 3' }),
              ],
            }),
          ],
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-timeline-item]');
      expect(items.length).toBe(3);
      expect((items[0] as HTMLElement).getAttribute('data-status')).toBe('completed');
      expect((items[1] as HTMLElement).getAttribute('data-status')).toBe('active');
      expect((items[2] as HTMLElement).getAttribute('data-status')).toBe('pending');
    });

    it('should work with error states', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            status: 'error',
            children: () => [
              TimelineMarker({ children: '✗' }),
              TimelineContent({
                children: () => [
                  TimelineTitle({ children: 'Deployment failed' }),
                  TimelineDescription({ children: 'Error: timeout exceeded' }),
                ],
              }),
            ],
          }),
        });
      const { container } = renderComponent(component);

      const itemEl = container.querySelector('[data-timeline-item]') as HTMLElement;
      expect(itemEl.getAttribute('data-status')).toBe('error');
      expect(container.querySelector('[data-timeline-title]')?.textContent).toBe(
        'Deployment failed'
      );
    });

    it('should support conditional rendering of components', () => {
      const showTimestamp = false;
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            children: TimelineContent({
              children: () => [
                TimelineTitle({ children: 'Event' }),
                showTimestamp ? TimelineTimestamp({ children: 'Now' }) : null,
              ],
            }),
          }),
        });
      const { container } = renderComponent(component);

      expect(container.querySelector('[data-timeline-timestamp]')).toBeNull();
    });
  });

  describe('Accessibility', () => {
    it('should have proper semantic structure', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({}),
        });
      const { container } = renderComponent(component);

      const timeline = container.querySelector('[role="list"]');
      const item = container.querySelector('[role="listitem"]');

      expect(timeline).toBeTruthy();
      expect(item).toBeTruthy();
    });

    it('should hide decorative elements from screen readers', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            children: () => [TimelineMarker({}), TimelineConnector({})],
          }),
        });
      const { container } = renderComponent(component);

      const marker = container.querySelector('[data-timeline-marker]') as HTMLElement;
      const connector = container.querySelector('[data-timeline-connector]') as HTMLElement;

      expect(marker.getAttribute('aria-hidden')).toBe('true');
      expect(connector.getAttribute('aria-hidden')).toBe('true');
    });

    it('should support aria-label on timeline', () => {
      const component = () =>
        Timeline({
          'aria-label': 'Activity history',
        });
      const { container } = renderComponent(component);

      const timeline = container.querySelector('[data-timeline]') as HTMLElement;
      expect(timeline.getAttribute('aria-label')).toBe('Activity history');
    });

    it('should use time element for timestamps', () => {
      const component = () =>
        TimelineTimestamp({
          datetime: '2024-01-01T12:00:00Z',
          children: 'January 1',
        });
      const { container } = renderComponent(component);

      const timeEl = container.querySelector('time');
      expect(timeEl).toBeTruthy();
      expect(timeEl?.tagName).toBe('TIME');
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with mixed status items', () => {
      const component = () =>
        Timeline({
          children: () => [
            TimelineItem({ status: 'completed' }),
            TimelineItem({ status: 'completed' }),
            TimelineItem({ status: 'active' }),
            TimelineItem({ status: 'pending' }),
            TimelineItem({ status: 'pending' }),
          ],
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-timeline-item]');
      expect(items.length).toBe(5);
    });

    it('should maintain proper nesting structure', () => {
      const component = () =>
        Timeline({
          children: () => TimelineItem({
            children: () => [
              TimelineMarker({}),
              TimelineConnector({}),
              TimelineContent({
                children: () => [
                  TimelineTitle({ children: 'Title' }),
                  TimelineDescription({ children: 'Description' }),
                  TimelineTimestamp({ children: 'Time' }),
                ],
              }),
            ],
          }),
        });
      const { container } = renderComponent(component);

      const timeline = container.querySelector('[data-timeline]');
      const item = timeline?.querySelector('[data-timeline-item]');
      const content = item?.querySelector('[data-timeline-content]');
      const title = content?.querySelector('[data-timeline-title]');

      expect(timeline).toBeTruthy();
      expect(item).toBeTruthy();
      expect(content).toBeTruthy();
      expect(title).toBeTruthy();
    });
  });
});
