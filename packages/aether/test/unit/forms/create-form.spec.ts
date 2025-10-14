/**
 * Tests for createForm
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createForm } from '../../../src/forms/create-form';
import type { FormConfig } from '../../../src/forms/types';

describe('createForm', () => {
  describe('Basic Form Creation', () => {
    it('should create form with initial values', () => {
      const form = createForm({
        initialValues: { email: '', password: '' },
      });

      expect(form.values).toEqual({ email: '', password: '' });
      expect(form.errors).toEqual({});
      expect(form.touched).toEqual({});
      expect(form.isSubmitting).toBe(false);
      expect(form.isValid).toBe(true);
      expect(form.isDirty).toBe(false);
    });

    it('should create form with complex initial values', () => {
      const form = createForm({
        initialValues: {
          user: {
            name: 'John',
            email: 'john@example.com',
          },
          preferences: {
            theme: 'dark',
            notifications: true,
          },
        },
      });

      expect(form.values.user.name).toBe('John');
      expect(form.values.preferences.theme).toBe('dark');
    });
  });

  describe('Field Value Management', () => {
    it('should set field value', () => {
      const form = createForm({
        initialValues: { email: '', password: '' },
      });

      form.setFieldValue('email', 'test@example.com');

      expect(form.values.email).toBe('test@example.com');
      expect(form.isDirty).toBe(true);
    });

    it('should set multiple field values', () => {
      const form = createForm({
        initialValues: { email: '', password: '', name: '' },
      });

      form.setFieldValue('email', 'test@example.com');
      form.setFieldValue('password', 'password123');
      form.setFieldValue('name', 'John');

      expect(form.values.email).toBe('test@example.com');
      expect(form.values.password).toBe('password123');
      expect(form.values.name).toBe('John');
    });

    it('should track dirty state', () => {
      const form = createForm({
        initialValues: { email: 'initial@example.com' },
      });

      expect(form.isDirty).toBe(false);

      form.setFieldValue('email', 'changed@example.com');
      expect(form.isDirty).toBe(true);
    });
  });

  describe('Touched State Management', () => {
    it('should set field as touched', () => {
      const form = createForm({
        initialValues: { email: '' },
      });

      form.setFieldTouched('email', true);

      expect(form.touched.email).toBe(true);
    });

    it('should set multiple fields as touched', () => {
      const form = createForm({
        initialValues: { email: '', password: '', name: '' },
      });

      form.setFieldTouched('email', true);
      form.setFieldTouched('password', true);

      expect(form.touched.email).toBe(true);
      expect(form.touched.password).toBe(true);
      expect(form.touched.name).toBeUndefined();
    });
  });

  describe('Error Management', () => {
    it('should set field error', () => {
      const form = createForm({
        initialValues: { email: '' },
      });

      form.setFieldError('email', 'Invalid email');

      expect(form.errors.email).toBe('Invalid email');
      expect(form.isValid).toBe(false);
    });

    it('should clear field error', () => {
      const form = createForm({
        initialValues: { email: '' },
      });

      form.setFieldError('email', 'Invalid email');
      expect(form.errors.email).toBe('Invalid email');

      form.setFieldError('email', undefined);
      expect(form.errors.email).toBeUndefined();
      expect(form.isValid).toBe(true);
    });
  });

  describe('Sync Validation', () => {
    it('should validate field on blur', async () => {
      const form = createForm({
        initialValues: { email: '' },
        validate: {
          email: (value) => (!value ? 'Required' : undefined),
        },
        validateOn: 'blur',
      });

      form.setFieldTouched('email', true);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(form.errors.email).toBe('Required');
    });

    it('should validate field on change', async () => {
      const form = createForm({
        initialValues: { email: '' },
        validate: {
          email: (value) => (!value ? 'Required' : undefined),
        },
        validateOn: 'change',
      });

      form.setFieldValue('email', '');
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(form.errors.email).toBe('Required');
    });

    it('should validate multiple fields', async () => {
      const form = createForm({
        initialValues: { email: '', password: '' },
        validate: {
          email: (value) => (!value ? 'Email required' : undefined),
          password: (value) => (value.length < 8 ? 'Password too short' : undefined),
        },
      });

      const valid = await form.validateForm();

      expect(valid).toBe(false);
      expect(form.errors.email).toBe('Email required');
      expect(form.errors.password).toBe('Password too short');
    });

    it('should clear errors when validation passes', async () => {
      const form = createForm({
        initialValues: { email: '' },
        validate: {
          email: (value) => (!value ? 'Required' : undefined),
        },
      });

      await form.validateForm();
      expect(form.errors.email).toBe('Required');

      form.setFieldValue('email', 'test@example.com');
      await form.validateField('email');

      expect(form.errors.email).toBeUndefined();
      expect(form.isValid).toBe(true);
    });
  });

  describe('Async Validation', () => {
    it('should handle async validation', async () => {
      const form = createForm({
        initialValues: { username: '' },
        validate: {
          username: async (value) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return value === 'taken' ? 'Username taken' : undefined;
          },
        },
      });

      form.setFieldValue('username', 'taken');
      await form.validateField('username');

      expect(form.errors.username).toBe('Username taken');
    });

    it('should handle async validation in validateForm', async () => {
      const form = createForm({
        initialValues: { username: '', email: '' },
        validate: {
          username: async (value) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return value === 'taken' ? 'Username taken' : undefined;
          },
          email: async (value) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return !value.includes('@') ? 'Invalid email' : undefined;
          },
        },
      });

      form.setFieldValue('username', 'taken');
      form.setFieldValue('email', 'invalid');

      const valid = await form.validateForm();

      expect(valid).toBe(false);
      expect(form.errors.username).toBe('Username taken');
      expect(form.errors.email).toBe('Invalid email');
    });
  });

  describe('Schema Validation', () => {
    it('should validate with Zod-like schema', async () => {
      const schema = {
        safeParse: (value: any) => {
          const errors = [];
          if (!value.email) {
            errors.push({ path: ['email'], message: 'Email required' });
          }
          if (value.password && value.password.length < 8) {
            errors.push({ path: ['password'], message: 'Password too short' });
          }
          return errors.length > 0 ? { success: false, error: { issues: errors } } : { success: true, data: value };
        },
      };

      const form = createForm({
        initialValues: { email: '', password: '123' },
        validate: schema,
      });

      const valid = await form.validateForm();

      expect(valid).toBe(false);
      expect(form.errors.email).toBe('Email required');
      expect(form.errors.password).toBe('Password too short');
    });

    it('should validate field with schema', async () => {
      const schema = {
        safeParse: (value: any) => {
          if (!value.email) {
            return {
              success: false,
              error: { issues: [{ path: ['email'], message: 'Email required' }] },
            };
          }
          return { success: true, data: value };
        },
      };

      const form = createForm({
        initialValues: { email: '', password: '' },
        validate: schema,
      });

      const valid = await form.validateField('email');

      expect(valid).toBe(false);
      expect(form.errors.email).toBe('Email required');
    });
  });

  describe('Form Submission', () => {
    it('should submit form with valid data', async () => {
      const onSubmit = vi.fn();
      const form = createForm({
        initialValues: { email: 'test@example.com', password: 'password123' },
        validate: {
          email: (value) => (!value ? 'Required' : undefined),
          password: (value) => (value.length < 8 ? 'Too short' : undefined),
        },
        onSubmit,
      });

      await form.handleSubmit();

      expect(onSubmit).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });

    it('should not submit form with invalid data', async () => {
      const onSubmit = vi.fn();
      const onError = vi.fn();

      const form = createForm({
        initialValues: { email: '', password: '' },
        validate: {
          email: (value) => (!value ? 'Email required' : undefined),
          password: (value) => (value.length < 8 ? 'Password too short' : undefined),
        },
        onSubmit,
        onError,
      });

      await form.handleSubmit();

      expect(onSubmit).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith({
        email: 'Email required',
        password: 'Password too short',
      });
    });

    it('should mark all fields as touched on submit', async () => {
      const form = createForm({
        initialValues: { email: '', password: '', name: '' },
      });

      expect(form.touched).toEqual({});

      await form.handleSubmit();

      expect(form.touched.email).toBe(true);
      expect(form.touched.password).toBe(true);
      expect(form.touched.name).toBe(true);
    });

    it('should set isSubmitting during submission', async () => {
      let isSubmittingDuringSubmit = false;
      const onSubmit = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const form = createForm({
        initialValues: { email: 'test@example.com' },
        onSubmit: async (values) => {
          isSubmittingDuringSubmit = form.isSubmitting;
          await onSubmit(values);
        },
      });

      expect(form.isSubmitting).toBe(false);
      await form.handleSubmit();

      expect(isSubmittingDuringSubmit).toBe(true);
      expect(form.isSubmitting).toBe(false);
    });
  });

  describe('Form Reset', () => {
    it('should reset form to initial values', () => {
      const form = createForm({
        initialValues: { email: '', password: '' },
      });

      form.setFieldValue('email', 'test@example.com');
      form.setFieldValue('password', 'password123');
      form.setFieldTouched('email', true);
      form.setFieldError('email', 'Error');

      form.reset();

      expect(form.values).toEqual({ email: '', password: '' });
      expect(form.touched).toEqual({});
      expect(form.errors).toEqual({});
      expect(form.isDirty).toBe(false);
    });

    it('should call onReset callback', () => {
      const onReset = vi.fn();
      const form = createForm({
        initialValues: { email: '' },
        onReset,
      });

      form.reset();

      expect(onReset).toHaveBeenCalled();
    });
  });

  describe('Field Props Helper', () => {
    it('should return correct field props', () => {
      const form = createForm({
        initialValues: { email: 'test@example.com' },
      });

      const props = form.getFieldProps('email');

      expect(props.name).toBe('email');
      expect(props.value).toBe('test@example.com');
      expect(typeof props.onInput).toBe('function');
      expect(typeof props.onBlur).toBe('function');
    });

    it('should handle input event', () => {
      const form = createForm({
        initialValues: { email: '' },
      });

      const props = form.getFieldProps('email');
      const event = {
        target: { value: 'test@example.com' },
      } as unknown as Event;

      props.onInput(event);

      expect(form.values.email).toBe('test@example.com');
    });

    it('should handle blur event', () => {
      const form = createForm({
        initialValues: { email: '' },
      });

      const props = form.getFieldProps('email');
      props.onBlur(new Event('blur'));

      expect(form.touched.email).toBe(true);
    });
  });
});
