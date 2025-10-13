/**
 * Tests for data components index exports
 */

import { describe, it, expect } from 'vitest';
import * as DataComponents from '../../../src/components/data/index.js';

describe('Data Components Exports', () => {
  it('should export Table components', () => {
    expect(DataComponents.Table).toBeDefined();
    expect(DataComponents.TableCaption).toBeDefined();
    expect(DataComponents.TableHeader).toBeDefined();
    expect(DataComponents.TableBody).toBeDefined();
    expect(DataComponents.TableFooter).toBeDefined();
    expect(DataComponents.TableRow).toBeDefined();
    expect(DataComponents.TableHead).toBeDefined();
    expect(DataComponents.TableCell).toBeDefined();
  });

  it('should export Card components', () => {
    expect(DataComponents.Card).toBeDefined();
    expect(DataComponents.CardHeader).toBeDefined();
    expect(DataComponents.CardTitle).toBeDefined();
    expect(DataComponents.CardDescription).toBeDefined();
    expect(DataComponents.CardContent).toBeDefined();
    expect(DataComponents.CardFooter).toBeDefined();
  });

  it('should export Badge component', () => {
    expect(DataComponents.Badge).toBeDefined();
  });

  it('should export Avatar components', () => {
    expect(DataComponents.Avatar).toBeDefined();
    expect(DataComponents.AvatarImage).toBeDefined();
    expect(DataComponents.AvatarFallback).toBeDefined();
  });

  it('should export Alert components', () => {
    expect(DataComponents.Alert).toBeDefined();
    expect(DataComponents.AlertIcon).toBeDefined();
    expect(DataComponents.AlertTitle).toBeDefined();
    expect(DataComponents.AlertDescription).toBeDefined();
  });

  it('should export Code component', () => {
    expect(DataComponents.Code).toBeDefined();
  });

  it('should export Kbd component', () => {
    expect(DataComponents.Kbd).toBeDefined();
  });

  it('should export Image component', () => {
    expect(DataComponents.Image).toBeDefined();
  });

  it('should export Empty components', () => {
    expect(DataComponents.Empty).toBeDefined();
    expect(DataComponents.EmptyIcon).toBeDefined();
    expect(DataComponents.EmptyTitle).toBeDefined();
    expect(DataComponents.EmptyDescription).toBeDefined();
    expect(DataComponents.EmptyActions).toBeDefined();
  });

  it('should export Rating components', () => {
    expect(DataComponents.Rating).toBeDefined();
    expect(DataComponents.RatingItem).toBeDefined();
  });

  it('should export Timeline components', () => {
    expect(DataComponents.Timeline).toBeDefined();
    expect(DataComponents.TimelineItem).toBeDefined();
    expect(DataComponents.TimelineMarker).toBeDefined();
    expect(DataComponents.TimelineConnector).toBeDefined();
    expect(DataComponents.TimelineContent).toBeDefined();
    expect(DataComponents.TimelineTitle).toBeDefined();
    expect(DataComponents.TimelineDescription).toBeDefined();
    expect(DataComponents.TimelineTimestamp).toBeDefined();
  });

  it('should export Tree components', () => {
    expect(DataComponents.Tree).toBeDefined();
    expect(DataComponents.TreeItem).toBeDefined();
    expect(DataComponents.TreeTrigger).toBeDefined();
    expect(DataComponents.TreeContent).toBeDefined();
    expect(DataComponents.TreeLabel).toBeDefined();
  });

  it('should export Transfer components', () => {
    expect(DataComponents.Transfer).toBeDefined();
    expect(DataComponents.TransferList).toBeDefined();
    expect(DataComponents.TransferControls).toBeDefined();
  });

  it('should export VirtualList component', () => {
    expect(DataComponents.VirtualList).toBeDefined();
  });
});
