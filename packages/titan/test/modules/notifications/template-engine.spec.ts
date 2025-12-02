import { describe, it, expect, beforeEach } from '@jest/globals';
import { TemplateEngine } from '../../../src/modules/notifications/template-engine.js';
import type { NotificationTemplate } from '../../../src/modules/notifications/template-engine.js';

describe('TemplateEngine', () => {
  let templateEngine: TemplateEngine;

  beforeEach(() => {
    templateEngine = new TemplateEngine();
  });

  describe('Template Registration', () => {
    it('should register and retrieve templates', async () => {
      const template: NotificationTemplate = {
        id: 'welcome-email',
        name: 'Welcome Email',
        engine: 'plain',
        channels: ['email'],
        content: {
          email: {
            subject: 'Welcome to {{appName}}!',
            html: '<h1>Hello {{userName}}</h1><p>Welcome to our platform!</p>',
            text: 'Hello {{userName}}, welcome to our platform!',
          },
        },
        variables: [
          { name: 'appName', type: 'string' },
          { name: 'userName', type: 'string' },
        ],
      };

      await templateEngine.registerTemplate(template);
      const retrieved = templateEngine.getTemplate('welcome-email');

      expect(retrieved).toEqual(template);
    });

    it('should list all registered templates', async () => {
      const template1: NotificationTemplate = {
        id: 'template1',
        name: 'Template 1',
        engine: 'plain',
        channels: ['email'],
        content: {
          email: {
            subject: 'Subject 1',
            html: 'Body 1',
            text: 'Body 1',
          },
        },
        variables: [],
      };

      const template2: NotificationTemplate = {
        id: 'template2',
        name: 'Template 2',
        engine: 'plain',
        channels: ['sms'],
        content: {
          sms: {
            message: 'Body 2',
          },
        },
        variables: [],
      };

      await templateEngine.registerTemplate(template1);
      await templateEngine.registerTemplate(template2);

      const templates = templateEngine.listTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(2);
      expect(templates.map((t) => t.id)).toContain('template1');
      expect(templates.map((t) => t.id)).toContain('template2');
    });

    it('should remove templates', async () => {
      const template: NotificationTemplate = {
        id: 'to-remove',
        name: 'To Remove',
        engine: 'plain',
        channels: ['email'],
        content: {
          email: {
            subject: 'Subject',
            html: 'Body',
            text: 'Body',
          },
        },
        variables: [],
      };

      await templateEngine.registerTemplate(template);
      expect(templateEngine.getTemplate('to-remove')).toBeDefined();

      await templateEngine.removeTemplate('to-remove');
      expect(templateEngine.getTemplate('to-remove')).toBeUndefined();
    });

    it('should throw error for template without channels', async () => {
      const template: any = {
        id: 'invalid',
        name: 'Invalid',
        engine: 'plain',
        channels: [],
        content: {
          email: {
            subject: 'Test',
            html: 'Test',
          },
        },
      };

      await expect(templateEngine.registerTemplate(template)).rejects.toThrow('At least one channel is required');
    });

    it('should throw error for template without content', async () => {
      const template: any = {
        id: 'invalid',
        name: 'Invalid',
        engine: 'plain',
        channels: ['email'],
        content: {},
      };

      await expect(templateEngine.registerTemplate(template)).rejects.toThrow('Template content is required');
    });
  });

  describe('Template Rendering', () => {
    beforeEach(async () => {
      const template: NotificationTemplate = {
        id: 'test-template',
        name: 'Test Template',
        engine: 'plain',
        channels: ['email'],
        content: {
          email: {
            subject: 'Hello {{recipient.name}}!',
            html: '<p>Hello <b>{{recipient.name}}</b>!</p><p>Your code: <code>{{code}}</code></p>',
            text: 'Your verification code is {{code}}. It expires in {{expiry}} minutes.',
          },
        },
        variables: [
          { name: 'recipient.name', type: 'string' },
          { name: 'code', type: 'string' },
          { name: 'expiry', type: 'number' },
        ],
      };
      await templateEngine.registerTemplate(template);
    });

    it('should render template with provided data', async () => {
      const data = {
        recipient: { name: 'Alice' },
        code: 'ABC123',
        expiry: 30,
      };

      const result = await templateEngine.render('test-template', data);

      expect(result.subject).toBe('Hello Alice!');
      expect(result.text).toBe('Your verification code is ABC123. It expires in 30 minutes.');
      expect(result.html).toContain('<b>Alice</b>');
      expect(result.html).toContain('<code>ABC123</code>');
    });

    it('should handle missing variables gracefully', async () => {
      const data = {
        recipient: { name: 'Bob' },
        // code and expiry are missing
      };

      const result = await templateEngine.render('test-template', data);

      expect(result.subject).toBe('Hello Bob!');
      expect(result.text).toContain('{{code}}'); // Unrendered placeholder
      expect(result.text).toContain('{{expiry}}'); // Unrendered placeholder
    });

    it('should return empty object for non-existent template', async () => {
      const result = await templateEngine.render('non-existent', {});
      expect(result).toEqual({});
    });
  });

  describe('Variable Extraction', () => {
    it('should extract variables from template content', () => {
      const content = '{{greeting}} {{user.name}}! Your order {{order.id}} total is {{order.total}} {{currency}}.';

      const extracted = templateEngine.extractVariables(content);

      expect(extracted).toContain('greeting');
      expect(extracted).toContain('user.name');
      expect(extracted).toContain('order.id');
      expect(extracted).toContain('order.total');
      expect(extracted).toContain('currency');
    });

    it('should extract variables from object', () => {
      const obj = {
        subject: '{{title}}',
        body: '{{message}} from {{sender}}',
      };

      const extracted = templateEngine.extractVariables(obj);

      expect(extracted).toContain('title');
      expect(extracted).toContain('message');
      expect(extracted).toContain('sender');
    });

    it('should handle empty content', () => {
      const extracted = templateEngine.extractVariables('');
      expect(extracted).toEqual([]);
    });
  });

  describe('Variable Replacement', () => {
    it('should replace simple variables', () => {
      const content = 'Hello {{name}}!';
      const data = { name: 'World' };

      const result = templateEngine.replaceVariables(content, data);

      expect(result).toBe('Hello World!');
    });

    it('should replace nested variables', () => {
      const content = 'Hello {{user.name}}!';
      const data = { user: { name: 'Alice' } };

      const result = templateEngine.replaceVariables(content, data);

      expect(result).toBe('Hello Alice!');
    });

    it('should handle multiple variables', () => {
      const content = '{{greeting}} {{name}}, your code is {{code}}';
      const data = { greeting: 'Hi', name: 'Bob', code: '12345' };

      const result = templateEngine.replaceVariables(content, data);

      expect(result).toBe('Hi Bob, your code is 12345');
    });

    it('should leave missing variables unreplaced', () => {
      const content = 'Hello {{name}}, {{missing}}!';
      const data = { name: 'Charlie' };

      const result = templateEngine.replaceVariables(content, data);

      expect(result).toBe('Hello Charlie, {{missing}}!');
    });
  });

  describe('Notification Processing', () => {
    it('should process notification with template', async () => {
      const template: NotificationTemplate = {
        id: 'notification-template',
        name: 'Notification Template',
        engine: 'plain',
        channels: ['email'],
        content: {
          email: {
            subject: '{{type}}: {{title}}',
            html: '<div class="{{type}}"><h2>{{title}}</h2><p>{{body}}</p></div>',
            text: '{{body}}',
          },
        },
        variables: [
          { name: 'type', type: 'string' },
          { name: 'title', type: 'string' },
          { name: 'body', type: 'string' },
        ],
      };

      await templateEngine.registerTemplate(template);

      const notification = {
        id: 'notif-1',
        type: 'warning',
        title: 'System Maintenance',
        body: 'The system will be down for maintenance.',
        data: {},
        templateId: 'notification-template',
      };

      const processed = await templateEngine.processNotification(notification);

      expect(processed.subject).toBe('warning: System Maintenance');
      expect(processed.text).toBe('The system will be down for maintenance.');
    });

    it('should process notification without template', async () => {
      const notification = {
        id: 'notif-2',
        type: 'info',
        title: 'Direct Message',
        body: 'This is a direct message without template.',
        data: {},
      };

      const processed = await templateEngine.processNotification(notification);

      expect(processed.title).toBe('Direct Message');
      expect(processed.body).toBe('This is a direct message without template.');
    });
  });

  describe('Channel-Specific Rendering', () => {
    it('should render for email channel', async () => {
      const template: NotificationTemplate = {
        id: 'multi-channel',
        name: 'Multi Channel',
        engine: 'plain',
        channels: ['email', 'sms'],
        content: {
          email: {
            subject: 'Email: {{message}}',
            html: '<p>{{message}}</p>',
            text: '{{message}}',
          },
          sms: {
            message: 'SMS: {{message}}',
          },
        },
        variables: [{ name: 'message', type: 'string' }],
      };

      await templateEngine.registerTemplate(template);

      const result = await templateEngine.renderForChannel('multi-channel', 'email', { message: 'Hello' });

      expect(result.subject).toBe('Email: Hello');
      expect(result.html).toBe('<p>Hello</p>');
    });

    it('should render for SMS channel', async () => {
      const template: NotificationTemplate = {
        id: 'sms-template',
        name: 'SMS Template',
        engine: 'plain',
        channels: ['sms'],
        content: {
          sms: {
            message: 'Your code is {{code}}',
          },
        },
        variables: [{ name: 'code', type: 'string' }],
      };

      await templateEngine.registerTemplate(template);

      const result = await templateEngine.renderForChannel('sms-template', 'sms', { code: '123456' });

      expect(result.text).toBe('Your code is 123456');
    });

    it('should return empty object for unsupported channel', async () => {
      const template: NotificationTemplate = {
        id: 'email-only',
        name: 'Email Only',
        engine: 'plain',
        channels: ['email'],
        content: {
          email: {
            subject: 'Test',
            html: 'Test',
          },
        },
        variables: [],
      };

      await templateEngine.registerTemplate(template);

      const result = await templateEngine.renderForChannel('email-only', 'sms', {});

      expect(result).toEqual({});
    });
  });

  describe('Template Management', () => {
    it('should get all templates including defaults', async () => {
      const templates = await templateEngine.getAllTemplates();

      expect(templates.length).toBeGreaterThan(0);
      // Default 'welcome' template should exist
      expect(templates.some((t) => t.id === 'welcome')).toBe(true);
    });

    it('should delete template by ID', async () => {
      const template: NotificationTemplate = {
        id: 'deletable',
        name: 'Deletable',
        engine: 'plain',
        channels: ['email'],
        content: {
          email: {
            subject: 'Test',
            html: 'Test',
          },
        },
        variables: [],
      };

      await templateEngine.registerTemplate(template);
      expect(templateEngine.getTemplate('deletable')).toBeDefined();

      const deleted = await templateEngine.deleteTemplate('deletable');

      expect(deleted).toBe(true);
      expect(templateEngine.getTemplate('deletable')).toBeUndefined();
    });

    it('should return false when deleting non-existent template', async () => {
      const deleted = await templateEngine.deleteTemplate('non-existent');
      expect(deleted).toBe(false);
    });
  });
});
