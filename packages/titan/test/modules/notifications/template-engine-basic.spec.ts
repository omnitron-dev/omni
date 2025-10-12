import { describe, it, expect, beforeEach } from '@jest/globals';
import { TemplateEngine } from '../../../src/modules/notifications/template-engine.js';

describe('TemplateEngine Basic', () => {
  let templateEngine: TemplateEngine;

  beforeEach(() => {
    // Create template engine without Redis
    templateEngine = new TemplateEngine();
  });

  describe('Template Registration', () => {
    it('should register and retrieve templates', async () => {
      const template = {
        id: 'welcome-email',
        name: 'Welcome Email',
        engine: 'plain' as const,
        channels: ['email'],
        content: {
          email: {
            subject: 'Welcome to {{appName}}!',
            html: '<h1>Hello {{userName}}</h1>',
            text: 'Hello {{userName}}',
          },
        },
      };

      await templateEngine.registerTemplate(template);
      const retrieved = templateEngine.getTemplate('welcome-email');

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('welcome-email');
      expect(retrieved?.name).toBe('Welcome Email');
    });

    it('should list all registered templates', async () => {
      const template1 = {
        id: 'template1',
        name: 'Template 1',
        engine: 'plain' as const,
        channels: ['email'],
        content: {
          email: {
            subject: 'Subject 1',
            html: 'Body 1',
          },
        },
      };

      const template2 = {
        id: 'template2',
        name: 'Template 2',
        engine: 'plain' as const,
        channels: ['sms'],
        content: {
          sms: {
            message: 'SMS Message',
          },
        },
      };

      await templateEngine.registerTemplate(template1);
      await templateEngine.registerTemplate(template2);

      const templates = templateEngine.listTemplates();
      expect(templates).toHaveLength(3); // 2 + 1 default template
      expect(templates.some((t) => t.id === 'template1')).toBe(true);
      expect(templates.some((t) => t.id === 'template2')).toBe(true);
    });

    it('should remove templates', async () => {
      const template = {
        id: 'to-remove',
        name: 'To Remove',
        engine: 'plain' as const,
        channels: ['email'],
        content: {
          email: {
            subject: 'Subject',
            html: 'Body',
          },
        },
      };

      await templateEngine.registerTemplate(template);
      expect(templateEngine.getTemplate('to-remove')).toBeDefined();

      await templateEngine.removeTemplate('to-remove');
      expect(templateEngine.getTemplate('to-remove')).toBeUndefined();
    });

    it('should validate required template fields', async () => {
      const invalidTemplate = {
        id: '',
        name: 'Invalid',
        engine: 'plain' as const,
        channels: ['email'],
        content: {},
      };

      await expect(templateEngine.registerTemplate(invalidTemplate)).rejects.toThrow('Template ID is required');
    });

    it('should validate channels requirement', async () => {
      const invalidTemplate = {
        id: 'no-channels',
        name: 'No Channels',
        engine: 'plain' as const,
        channels: [],
        content: {},
      };

      await expect(templateEngine.registerTemplate(invalidTemplate)).rejects.toThrow(
        'At least one channel is required'
      );
    });
  });

  describe('Template Rendering', () => {
    beforeEach(async () => {
      const template = {
        id: 'test-template',
        name: 'Test Template',
        engine: 'plain' as const,
        channels: ['email', 'sms'],
        content: {
          email: {
            subject: 'Hello {{name}}!',
            html: '<p>Your code is {{code}}</p>',
            text: 'Your code is {{code}}',
          },
          sms: {
            message: 'Code: {{code}}',
          },
        },
      };
      await templateEngine.registerTemplate(template);
    });

    it('should render template with provided data', async () => {
      const data = {
        name: 'Alice',
        code: 'ABC123',
      };

      const result = await templateEngine.render('test-template', data);

      expect(result.subject).toBe('Hello Alice!');
      expect(result.html).toBe('<p>Your code is ABC123</p>');
      expect(result.text).toBe('Your code is ABC123');
    });

    it('should handle missing template', async () => {
      const result = await templateEngine.render('non-existent', {});

      // Should return empty content when template not found
      expect(result.subject).toBeUndefined();
      expect(result.html).toBeUndefined();
      expect(result.text).toBeUndefined();
    });

    it('should render for specific channel', async () => {
      const data = { code: '123456' };
      const result = await templateEngine.renderForChannel('test-template', 'sms', data);

      expect(result.text).toBe('Code: 123456');
      expect(result.subject).toBeUndefined(); // SMS doesn't have subject
    });
  });

  describe('Default Templates', () => {
    it('should have welcome template registered by default', () => {
      const welcomeTemplate = templateEngine.getTemplate('welcome');

      expect(welcomeTemplate).toBeDefined();
      expect(welcomeTemplate?.name).toBe('Welcome Template');
      expect(welcomeTemplate?.channels).toContain('email');
      expect(welcomeTemplate?.channels).toContain('inApp');
    });

    it('should render default welcome template', async () => {
      const data = {
        userName: 'John',
        appName: 'MyApp',
      };

      const result = await templateEngine.render('welcome', data);

      expect(result.subject).toBe('Welcome to MyApp!');
      expect(result.html).toContain('Welcome John!');
      expect(result.text).toContain('Welcome John!');
    });
  });

  describe('Template Processing', () => {
    it('should process notification with template', async () => {
      const template = {
        id: 'notification-template',
        name: 'Notification Template',
        engine: 'plain' as const,
        channels: ['email'],
        content: {
          email: {
            subject: '{{type}}: {{title}}',
            html: '<div>{{body}}</div>',
            text: '{{body}}',
          },
        },
      };

      await templateEngine.registerTemplate(template);

      const notification = {
        id: 'notif-1',
        type: 'warning',
        title: 'System Alert',
        body: 'System maintenance scheduled',
        templateId: 'notification-template',
        data: {},
      };

      const processed = await templateEngine.processNotification(notification);

      expect(processed.subject).toBe('warning: System Alert');
      expect(processed.html).toBe('<div>System maintenance scheduled</div>');
      expect(processed.text).toBe('System maintenance scheduled');
    });

    it('should process notification without template', async () => {
      const notification = {
        id: 'notif-2',
        type: 'info',
        title: 'Direct Message',
        body: 'This is a direct message',
        data: {},
      };

      const processed = await templateEngine.processNotification(notification);

      // Should return original content when no template
      expect(processed.subject).toBe('Direct Message');
      expect(processed.text).toBe('This is a direct message');
    });
  });

  describe('Template Variable Extraction', () => {
    it('should extract variables from template content', () => {
      const content = 'Hello {{name}}, your order {{order.id}} is {{status}}.';
      const variables = templateEngine.extractVariables(content);

      expect(variables).toContain('name');
      expect(variables).toContain('order.id');
      expect(variables).toContain('status');
      expect(variables).toHaveLength(3);
    });

    it('should handle duplicate variables', () => {
      const content = 'Hi {{name}}! {{name}}, your code is {{code}}. Use {{code}} to login.';
      const variables = templateEngine.extractVariables(content);

      expect(variables).toContain('name');
      expect(variables).toContain('code');
      expect(variables).toHaveLength(2); // No duplicates
    });

    it('should extract nested variables', () => {
      const content = '{{user.profile.name}} from {{user.address.city}}, {{user.address.country}}';
      const variables = templateEngine.extractVariables(content);

      expect(variables).toContain('user.profile.name');
      expect(variables).toContain('user.address.city');
      expect(variables).toContain('user.address.country');
    });
  });

  describe('Template Content Replacement', () => {
    it('should replace simple variables', () => {
      const content = 'Hello {{name}}, welcome!';
      const data = { name: 'Alice' };
      const result = templateEngine.replaceVariables(content, data);

      expect(result).toBe('Hello Alice, welcome!');
    });

    it('should replace nested variables', () => {
      const content = 'Order {{order.id}} total: {{order.total}}';
      const data = {
        order: {
          id: '12345',
          total: '$99.99',
        },
      };
      const result = templateEngine.replaceVariables(content, data);

      expect(result).toBe('Order 12345 total: $99.99');
    });

    it('should handle missing variables gracefully', () => {
      const content = 'Hello {{name}}, your code is {{code}}';
      const data = { name: 'Bob' };
      const result = templateEngine.replaceVariables(content, data);

      expect(result).toBe('Hello Bob, your code is {{code}}');
    });

    it('should handle null and undefined values', () => {
      const content = 'Value: {{value}}, Null: {{nullValue}}, Undefined: {{undefinedValue}}';
      const data = {
        value: 'test',
        nullValue: null,
        undefinedValue: undefined,
      };
      const result = templateEngine.replaceVariables(content, data);

      expect(result).toContain('Value: test');
      // Null and undefined should not be replaced or show as string literals
      expect(result).toContain('{{nullValue}}');
      expect(result).toContain('{{undefinedValue}}');
    });
  });

  describe('Localization Support', () => {
    it('should support localized templates', async () => {
      const template = {
        id: 'localized',
        name: 'Localized Template',
        engine: 'plain' as const,
        channels: ['email'],
        locales: ['en', 'es', 'fr'],
        defaultLocale: 'en',
        content: {
          email: {
            subject: 'Welcome {{name}}!',
            html: '<p>Welcome!</p>',
            text: 'Welcome!',
          },
        },
      };

      await templateEngine.registerTemplate(template);
      const retrieved = templateEngine.getTemplate('localized');

      expect(retrieved?.locales).toContain('en');
      expect(retrieved?.locales).toContain('es');
      expect(retrieved?.defaultLocale).toBe('en');
    });
  });
});
