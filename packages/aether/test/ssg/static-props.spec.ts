/**
 * Static Props Tests
 */

import { describe, it, expect } from 'vitest';
import {
  executeStaticProps,
  createStaticPropsContext,
  mergeStaticProps,
  combineStaticProps,
  validateStaticPropsResult,
  createStaticPropsResult,
  notFound,
  redirect,
} from '../../src/ssg/static-props.js';
import type { GetStaticProps } from '../../src/ssg/types.js';

describe('Static Props', () => {
  describe('executeStaticProps', () => {
    it('should execute getStaticProps and return result', async () => {
      const getStaticProps: GetStaticProps = async () => ({
        props: { title: 'Test Page' },
      });

      const context = createStaticPropsContext({});
      const result = await executeStaticProps(getStaticProps, context);

      expect(result.props).toEqual({ title: 'Test Page' });
    });

    it('should handle notFound result', async () => {
      const getStaticProps: GetStaticProps = async () => ({
        props: {},
        notFound: true,
      });

      const context = createStaticPropsContext({});
      const result = await executeStaticProps(getStaticProps, context);

      expect(result.notFound).toBe(true);
    });

    it('should handle redirect result', async () => {
      const getStaticProps: GetStaticProps = async () => ({
        props: {},
        redirect: {
          destination: '/other-page',
          permanent: false,
        },
      });

      const context = createStaticPropsContext({});
      const result = await executeStaticProps(getStaticProps, context);

      expect(result.redirect).toEqual({
        destination: '/other-page',
        permanent: false,
      });
    });

    it('should pass params to context', async () => {
      const getStaticProps: GetStaticProps = async (ctx) => ({
        props: { slug: ctx.params.slug },
      });

      const context = createStaticPropsContext({ slug: 'test-post' });
      const result = await executeStaticProps(getStaticProps, context);

      expect(result.props).toEqual({ slug: 'test-post' });
    });

    it('should handle revalidate option', async () => {
      const getStaticProps: GetStaticProps = async () => ({
        props: { data: 'test' },
        revalidate: 60,
      });

      const context = createStaticPropsContext({});
      const result = await executeStaticProps(getStaticProps, context);

      expect(result.revalidate).toBe(60);
    });

    it('should throw error for invalid result', async () => {
      const getStaticProps = async () => null as any;

      const context = createStaticPropsContext({});
      await expect(executeStaticProps(getStaticProps, context)).rejects.toThrow();
    });
  });

  describe('createStaticPropsContext', () => {
    it('should create context with params', () => {
      const context = createStaticPropsContext({ id: '123' });

      expect(context.params).toEqual({ id: '123' });
    });

    it('should include locale if provided', () => {
      const context = createStaticPropsContext({ id: '123' }, { locale: 'en' });

      expect(context.locale).toBe('en');
    });

    it('should include preview mode', () => {
      const context = createStaticPropsContext({}, { preview: true });

      expect(context.preview).toBe(true);
    });
  });

  describe('mergeStaticProps', () => {
    it('should merge multiple results', () => {
      const result1 = createStaticPropsResult({ a: 1 });
      const result2 = createStaticPropsResult({ b: 2 });

      const merged = mergeStaticProps(result1, result2);

      expect(merged.props).toEqual({ a: 1, b: 2 });
    });

    it('should use shortest revalidate time', () => {
      const result1 = createStaticPropsResult({ a: 1 }, { revalidate: 60 });
      const result2 = createStaticPropsResult({ b: 2 }, { revalidate: 30 });

      const merged = mergeStaticProps(result1, result2);

      expect(merged.revalidate).toBe(30);
    });

    it('should merge tags', () => {
      const result1 = createStaticPropsResult({ a: 1 }, { tags: ['tag1'] });
      const result2 = createStaticPropsResult({ b: 2 }, { tags: ['tag2'] });

      const merged = mergeStaticProps(result1, result2);

      expect(merged.tags).toEqual(['tag1', 'tag2']);
    });

    it('should return notFound if any result is notFound', () => {
      const result1 = createStaticPropsResult({ a: 1 });
      const result2 = notFound();

      const merged = mergeStaticProps(result1, result2);

      expect(merged.notFound).toBe(true);
    });
  });

  describe('combineStaticProps', () => {
    it('should combine multiple getStaticProps functions', async () => {
      const getProps1: GetStaticProps = async () => ({
        props: { a: 1 },
      });

      const getProps2: GetStaticProps = async () => ({
        props: { b: 2 },
      });

      const combined = combineStaticProps(getProps1, getProps2);
      const context = createStaticPropsContext({});
      const result = await combined(context);

      expect(result.props).toEqual({ a: 1, b: 2 });
    });
  });

  describe('validateStaticPropsResult', () => {
    it('should validate valid result', () => {
      const result = createStaticPropsResult({ data: 'test' });
      const errors = validateStaticPropsResult(result);

      expect(errors).toHaveLength(0);
    });

    it('should detect missing props', () => {
      const result = {} as any;
      const errors = validateStaticPropsResult(result);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes('props'))).toBe(true);
    });

    it('should validate revalidate value', () => {
      const result = { props: {}, revalidate: -1 };
      const errors = validateStaticPropsResult(result);

      expect(errors.some((e) => e.includes('revalidate'))).toBe(true);
    });

    it('should validate tags', () => {
      const result = { props: {}, tags: 'invalid' as any };
      const errors = validateStaticPropsResult(result);

      expect(errors.some((e) => e.includes('tags'))).toBe(true);
    });
  });

  describe('Helper functions', () => {
    it('notFound should create notFound result', () => {
      const result = notFound();

      expect(result.notFound).toBe(true);
      expect(result.props).toEqual({});
    });

    it('redirect should create redirect result', () => {
      const result = redirect('/new-page', true);

      expect(result.redirect).toEqual({
        destination: '/new-page',
        permanent: true,
      });
    });
  });
});
