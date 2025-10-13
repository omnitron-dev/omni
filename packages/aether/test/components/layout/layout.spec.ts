/**
 * Integration tests for all layout components
 */

import { describe, it, expect } from 'vitest';
import {
  Box,
  Flex,
  Grid,
  Stack,
  Container,
  Center,
  SimpleGrid,
  Masonry,
  AspectRatio,
  Divider,
  Separator,
  Space,
  Spacer,
} from '../../../src/components/layout/index.js';

describe('Layout Components', () => {
  it('should export all layout components', () => {
    expect(Box).toBeDefined();
    expect(Flex).toBeDefined();
    expect(Grid).toBeDefined();
    expect(Stack).toBeDefined();
    expect(Container).toBeDefined();
    expect(Center).toBeDefined();
    expect(SimpleGrid).toBeDefined();
    expect(Masonry).toBeDefined();
    expect(AspectRatio).toBeDefined();
    expect(Divider).toBeDefined();
    expect(Separator).toBeDefined();
    expect(Space).toBeDefined();
    expect(Spacer).toBeDefined();
  });

  it('should create components without errors', () => {
    expect(() => Box({ children: 'Box' })).not.toThrow();
    expect(() => Flex({ children: 'Flex' })).not.toThrow();
    expect(() => Grid({ children: 'Grid' })).not.toThrow();
    expect(() => Stack({ children: 'Stack' })).not.toThrow();
    expect(() => Container({ children: 'Container' })).not.toThrow();
    expect(() => Center({ children: 'Center' })).not.toThrow();
    expect(() => SimpleGrid({ children: 'SimpleGrid' })).not.toThrow();
    expect(() => Masonry({ children: 'Masonry' })).not.toThrow();
    expect(() => AspectRatio({ ratio: 16 / 9, children: 'AspectRatio' })).not.toThrow();
    expect(() => Divider({})).not.toThrow();
    expect(() => Separator({})).not.toThrow();
    expect(() => Space({ children: 'Space' })).not.toThrow();
    expect(() => Spacer({})).not.toThrow();
  });

  it('should support variant props', () => {
    expect(() => Box({ padding: 'md', bg: 'primary', children: 'Test' })).not.toThrow();
    expect(() => Flex({ gap: 'lg', rounded: 'md', children: 'Test' })).not.toThrow();
    expect(() => Grid({ columns: 3, padding: 'sm', children: 'Test' })).not.toThrow();
    expect(() => Container({ padding: 'xl', shadow: 'md', children: 'Test' })).not.toThrow();
  });

  it('should support CSS prop', () => {
    expect(() => Box({ css: { color: 'red' }, children: 'Test' })).not.toThrow();
    expect(() => Flex({ css: { width: '100%' }, children: 'Test' })).not.toThrow();
  });

  it('should support className prop', () => {
    expect(() => Box({ className: 'custom', children: 'Test' })).not.toThrow();
    expect(() => Flex({ class: 'custom-flex', children: 'Test' })).not.toThrow();
  });
});
