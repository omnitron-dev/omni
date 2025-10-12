import { describe, it, expect, beforeEach } from '@jest/globals';
import { TemplateEngine } from '../../../src/modules/notifications/template-engine.js';
import type { NotificationPayload, Recipient } from '../../../src/modules/notifications/notifications.service.js';

describe('TemplateEngine', () => {
  let templateEngine: TemplateEngine;

  beforeEach(() => {
    templateEngine = new TemplateEngine();
  });

  describe('Template Registration', () => {
    it('should register and retrieve templates', () => {
      const template = {
        id: 'welcome-email',
        name: 'Welcome Email',
        engine: 'plain' as const,
        channels: ['email'],
        content: {
          email: {
            subject: 'Welcome to {{appName}}!',
            html: '<h1>Hello {{userName}}</h1><p>Welcome to our platform!</p>',
            text: 'Hello {{userName}}, welcome to our platform!',
          },
        },
        variables: [
          { name: 'appName', type: 'string' as const },
          { name: 'userName', type: 'string' as const },
        ],
      };

      templateEngine.registerTemplate(template);
      const retrieved = templateEngine.getTemplate('welcome-email');

      expect(retrieved).toEqual(template);
    });

    it('should list all registered templates', () => {
      const template1 = {
        id: 'template1',
        name: 'Template 1',
        engine: 'plain' as const,
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

      const template2 = {
        id: 'template2',
        name: 'Template 2',
        engine: 'plain' as const,
        channels: ['sms'],
        content: {
          sms: {
            message: 'Body 2',
          },
        },
        variables: [],
      };

      templateEngine.registerTemplate(template1);
      templateEngine.registerTemplate(template2);

      const templates = templateEngine.listTemplates();
      expect(templates).toHaveLength(2);
      expect(templates.map((t) => t.id)).toContain('template1');
      expect(templates.map((t) => t.id)).toContain('template2');
    });

    it('should remove templates', () => {
      const template = {
        id: 'to-remove',
        name: 'To Remove',
        engine: 'plain' as const,
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

      templateEngine.registerTemplate(template);
      expect(templateEngine.getTemplate('to-remove')).toBeDefined();

      templateEngine.removeTemplate('to-remove');
      expect(templateEngine.getTemplate('to-remove')).toBeUndefined();
    });

    it('should validate template variables', () => {
      const template = {
        id: 'validation-test',
        name: 'Validation Test',
        subject: 'Hello {{name}}',
        body: 'Your code is {{code}} and expires at {{expiry}}',
        variables: ['name', 'code', 'expiry'],
      };

      templateEngine.registerTemplate(template);

      const validData = { name: 'John', code: '123456', expiry: '10:00 PM' };
      const invalidData = { name: 'John', code: '123456' }; // Missing expiry

      expect(templateEngine.validateTemplateData('validation-test', validData)).toBe(true);
      expect(templateEngine.validateTemplateData('validation-test', invalidData)).toBe(false);
    });
  });

  describe('Template Rendering', () => {
    beforeEach(() => {
      const template = {
        id: 'test-template',
        name: 'Test Template',
        subject: 'Hello {{recipient.name}}!',
        body: 'Your verification code is {{code}}. It expires in {{expiry}} minutes.',
        html: '<p>Hello <b>{{recipient.name}}</b>!</p><p>Your code: <code>{{code}}</code></p>',
        variables: ['recipient.name', 'code', 'expiry'],
      };
      templateEngine.registerTemplate(template);
    });

    it('should render template with provided data', () => {
      const data = {
        recipient: { name: 'Alice' },
        code: 'ABC123',
        expiry: 30,
      };

      const result = templateEngine.render('test-template', data);

      expect(result.subject).toBe('Hello Alice!');
      expect(result.body).toBe('Your verification code is ABC123. It expires in 30 minutes.');
      expect(result.html).toContain('<b>Alice</b>');
      expect(result.html).toContain('<code>ABC123</code>');
    });

    it('should handle missing variables gracefully', () => {
      const data = {
        recipient: { name: 'Bob' },
        // code and expiry are missing
      };

      const result = templateEngine.render('test-template', data);

      expect(result.subject).toBe('Hello Bob!');
      expect(result.body).toContain('{{code}}'); // Unrendered placeholder
      expect(result.body).toContain('{{expiry}}'); // Unrendered placeholder
    });

    it('should render templates with recipient localization', () => {
      const localizedTemplate = {
        id: 'localized',
        name: 'Localized Template',
        subject: {
          en: 'Welcome {{name}}!',
          es: '¡Bienvenido {{name}}!',
          fr: 'Bienvenue {{name}}!',
        },
        body: {
          en: 'Thank you for joining us.',
          es: 'Gracias por unirte a nosotros.',
          fr: 'Merci de nous avoir rejoint.',
        },
        variables: ['name'],
      };

      templateEngine.registerTemplate(localizedTemplate);

      const recipient: Recipient = {
        id: 'user1',
        email: 'user@example.com',
        locale: 'es',
      };

      const result = templateEngine.renderForRecipient('localized', { name: 'Carlos' }, recipient);

      expect(result.subject).toBe('¡Bienvenido Carlos!');
      expect(result.body).toBe('Gracias por unirte a nosotros.');
    });

    it('should fall back to default locale when recipient locale not available', () => {
      const template = {
        id: 'fallback-test',
        name: 'Fallback Test',
        subject: {
          en: 'English Subject',
          fr: 'French Subject',
        },
        body: {
          en: 'English Body',
          fr: 'French Body',
        },
        variables: [],
      };

      templateEngine.registerTemplate(template);

      const recipient: Recipient = {
        id: 'user1',
        email: 'user@example.com',
        locale: 'de', // German not available
      };

      const result = templateEngine.renderForRecipient('fallback-test', {}, recipient);

      expect(result.subject).toBe('English Subject'); // Falls back to 'en'
      expect(result.body).toBe('English Body');
    });
  });

  describe('Template Processing for Notifications', () => {
    it('should process notification with template', () => {
      const template = {
        id: 'notification-template',
        name: 'Notification Template',
        subject: '{{type}}: {{title}}',
        body: '{{body}}',
        html: '<div class="{{type}}"><h2>{{title}}</h2><p>{{body}}</p></div>',
        variables: ['type', 'title', 'body'],
      };

      templateEngine.registerTemplate(template);

      const notification: NotificationPayload = {
        id: 'notif-1',
        type: 'warning',
        title: 'System Maintenance',
        body: 'The system will be down for maintenance.',
        data: {},
        templateId: 'notification-template',
      };

      const processed = templateEngine.processNotification(notification);

      expect(processed.title).toBe('warning: System Maintenance');
      expect(processed.body).toBe('The system will be down for maintenance.');
      expect(processed).toHaveProperty('renderedHtml');
      expect(processed.renderedHtml).toContain('class="warning"');
    });

    it('should process notification without template', () => {
      const notification: NotificationPayload = {
        id: 'notif-2',
        type: 'info',
        title: 'Direct Message',
        body: 'This is a direct message without template.',
        data: {},
      };

      const processed = templateEngine.processNotification(notification);

      expect(processed.title).toBe('Direct Message');
      expect(processed.body).toBe('This is a direct message without template.');
      expect(processed).not.toHaveProperty('renderedHtml');
    });
  });

  describe('Template Validation', () => {
    it('should validate template syntax', () => {
      const validTemplate = {
        id: 'valid',
        name: 'Valid',
        subject: 'Hello {{name}}',
        body: 'Welcome {{name}}!',
        variables: ['name'],
      };

      const invalidTemplate = {
        id: 'invalid',
        name: 'Invalid',
        subject: 'Hello {{name', // Unclosed placeholder
        body: 'Welcome!',
        variables: ['name'],
      };

      expect(templateEngine.validateTemplate(validTemplate)).toBe(true);
      expect(templateEngine.validateTemplate(invalidTemplate)).toBe(false);
    });

    it('should extract variables from template', () => {
      const template = {
        id: 'extract-test',
        name: 'Extract Test',
        subject: '{{greeting}} {{user.name}}!',
        body: 'Your order {{order.id}} total is {{order.total}} {{currency}}.',
        html: '<p>{{greeting}} <b>{{user.name}}</b></p>',
        variables: [],
      };

      const extracted = templateEngine.extractVariables(template);

      expect(extracted).toContain('greeting');
      expect(extracted).toContain('user.name');
      expect(extracted).toContain('order.id');
      expect(extracted).toContain('order.total');
      expect(extracted).toContain('currency');
    });

    it('should clone template', () => {
      const original = {
        id: 'original',
        name: 'Original Template',
        subject: 'Subject',
        body: 'Body',
        variables: ['var1', 'var2'],
      };

      templateEngine.registerTemplate(original);
      const cloned = templateEngine.cloneTemplate('original', 'cloned', 'Cloned Template');

      expect(cloned.id).toBe('cloned');
      expect(cloned.name).toBe('Cloned Template');
      expect(cloned.subject).toBe(original.subject);
      expect(cloned.body).toBe(original.body);
      expect(cloned.variables).toEqual(original.variables);
    });
  });

  describe('Template Categories and Metadata', () => {
    it('should support template categories', () => {
      const templates = [
        {
          id: 'welcome-1',
          name: 'Welcome Email',
          subject: 'Welcome',
          body: 'Welcome to our app',
          category: 'onboarding',
          variables: [],
        },
        {
          id: 'password-reset',
          name: 'Password Reset',
          subject: 'Reset Password',
          body: 'Click to reset',
          category: 'security',
          variables: [],
        },
        {
          id: 'welcome-2',
          name: 'Welcome SMS',
          subject: 'Welcome',
          body: 'Welcome!',
          category: 'onboarding',
          variables: [],
        },
      ];

      templates.forEach((t) => templateEngine.registerTemplate(t));

      const onboardingTemplates = templateEngine.getTemplatesByCategory('onboarding');
      expect(onboardingTemplates).toHaveLength(2);
      expect(onboardingTemplates.map((t) => t.id)).toContain('welcome-1');
      expect(onboardingTemplates.map((t) => t.id)).toContain('welcome-2');

      const securityTemplates = templateEngine.getTemplatesByCategory('security');
      expect(securityTemplates).toHaveLength(1);
      expect(securityTemplates[0].id).toBe('password-reset');
    });

    it('should support template metadata', () => {
      const template = {
        id: 'metadata-test',
        name: 'Metadata Test',
        subject: 'Test',
        body: 'Test',
        variables: [],
        metadata: {
          author: 'John Doe',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-15'),
          version: '1.0.0',
          tags: ['test', 'example'],
          active: true,
        },
      };

      templateEngine.registerTemplate(template);
      const retrieved = templateEngine.getTemplate('metadata-test');

      expect(retrieved?.metadata?.author).toBe('John Doe');
      expect(retrieved?.metadata?.version).toBe('1.0.0');
      expect(retrieved?.metadata?.tags).toContain('test');
      expect(retrieved?.metadata?.active).toBe(true);
    });
  });

  describe('Template Compilation and Caching', () => {
    it('should cache compiled templates', () => {
      const template = {
        id: 'cached',
        name: 'Cached Template',
        subject: 'Hello {{name}}',
        body: 'Welcome {{name}}!',
        variables: ['name'],
      };

      templateEngine.registerTemplate(template);

      // First render
      const result1 = templateEngine.render('cached', { name: 'Alice' });

      // Second render should use cached version
      const result2 = templateEngine.render('cached', { name: 'Bob' });

      expect(result1.subject).toBe('Hello Alice');
      expect(result2.subject).toBe('Hello Bob');

      // Verify cache was used (implementation specific)
      const cacheStats = templateEngine.getCacheStats();
      expect(cacheStats.hits).toBeGreaterThan(0);
    });

    it('should invalidate cache when template is updated', () => {
      const template = {
        id: 'cache-invalidation',
        name: 'Cache Test',
        subject: 'Original: {{name}}',
        body: 'Original body',
        variables: ['name'],
      };

      templateEngine.registerTemplate(template);
      templateEngine.render('cache-invalidation', { name: 'Alice' });

      // Update template
      const updatedTemplate = {
        ...template,
        subject: 'Updated: {{name}}',
      };
      templateEngine.registerTemplate(updatedTemplate);

      const result = templateEngine.render('cache-invalidation', { name: 'Bob' });
      expect(result.subject).toBe('Updated: Bob');
    });
  });
});
