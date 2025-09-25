import { Injectable } from '../../nexus/index.js';
import { Redis } from 'ioredis';
import { hash } from './utils.js';

export interface TemplateOptions {
  enabled?: boolean;
  path?: string;
  cache?: boolean;
  cacheTTL?: number;
}

export interface RenderOptions {
  locale?: string;
  skipCache?: boolean;
  cacheTTL?: number;
}

export interface RenderedContent {
  subject?: string;
  html?: string;
  text?: string;
  data?: any;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  description?: string;
  engine: 'handlebars' | 'mustache' | 'plain' | 'custom';
  channels: string[];
  content: {
    email?: {
      subject: string;
      html: string;
      text?: string;
    };
    sms?: {
      message: string;
    };
    push?: {
      title: string;
      body: string;
    };
    inApp?: {
      title: string;
      body: string;
      component?: string;
    };
  };
  variables?: TemplateVariable[];
  locales?: string[];
  defaultLocale?: string;
  category?: string;
  tags?: string[];
  version?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface TemplateVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  required?: boolean;
  default?: any;
  format?: string;
  description?: string;
}

@Injectable()
export class TemplateEngine {
  private templates = new Map<string, NotificationTemplate>();
  private cacheKeyPrefix = 'notifications:template:cache:';

  constructor(
    private redis?: Redis,
    private options?: TemplateOptions
  ) {
    this.loadDefaultTemplates();
  }

  /**
   * Load default templates
   */
  private loadDefaultTemplates(): void {
    // Register default welcome template
    this.registerTemplate({
      id: 'welcome',
      name: 'Welcome Template',
      engine: 'plain',
      channels: ['email', 'inApp'],
      content: {
        email: {
          subject: 'Welcome to {{appName}}!',
          html: '<h1>Welcome {{userName}}!</h1><p>Thank you for joining {{appName}}.</p>',
          text: 'Welcome {{userName}}! Thank you for joining {{appName}}.'
        },
        inApp: {
          title: 'Welcome!',
          body: 'Thank you for joining {{appName}}, {{userName}}!'
        }
      },
      variables: [
        { name: 'userName', type: 'string', required: true },
        { name: 'appName', type: 'string', default: 'Our App' }
      ]
    });
  }

  /**
   * Register a notification template
   */
  async registerTemplate(template: NotificationTemplate): Promise<void> {
    // Validate template
    this.validateTemplate(template);

    // Store in memory
    this.templates.set(template.id, template);

    // Store in Redis for persistence
    if (this.options?.cache !== false) {
      const key = `notifications:template:${template.id}`;
      if (this.redis) {
        await this.redis.set(key, JSON.stringify(template));
      }
    }
  }

  /**
   * Render a template with data
   */
  async render(
    templateId: string,
    data: any,
    options: RenderOptions = {}
  ): Promise<RenderedContent> {
    // Check cache first
    if (!options.skipCache && this.options?.cache !== false) {
      const cached = await this.getCachedRender(templateId, data, options.locale);
      if (cached) {
        return cached;
      }
    }

    const template = this.templates.get(templateId);
    if (!template) {
      // Try loading from Redis
      const stored = this.redis ? await this.redis.get(`notifications:template:${templateId}`) : null;
      if (!stored) {
        // Return empty content when template not found
        return {};
      }
      const loadedTemplate = JSON.parse(stored) as NotificationTemplate;
      this.templates.set(templateId, loadedTemplate);
      return this.renderTemplate(loadedTemplate, data, options);
    }

    return this.renderTemplate(template, data, options);
  }

  /**
   * Render template content
   */
  private async renderTemplate(
    template: NotificationTemplate,
    data: any,
    options: RenderOptions
  ): Promise<RenderedContent> {
    const rendered: RenderedContent = {};

    // Simple variable replacement
    const replaceVariables = (text: string): string => {
      // Use the class method to replace all {{variable}} patterns
      return this.replaceVariables(text, data);
    };

    // Render email content if present
    if (template.content.email) {
      rendered.subject = replaceVariables(template.content.email.subject);
      rendered.html = replaceVariables(template.content.email.html);
      rendered.text = replaceVariables(template.content.email.text || '');
    }

    // Cache the rendered content
    if (this.options?.cache !== false) {
      await this.cacheRender(template.id, data, options.locale, rendered, options.cacheTTL);
    }

    return rendered;
  }

  /**
   * Get cached render
   */
  private async getCachedRender(
    templateId: string,
    data: any,
    locale?: string
  ): Promise<RenderedContent | null> {
    const cacheKey = this.getCacheKey(templateId, data, locale);
    const cached = this.redis ? await this.redis.get(cacheKey) : null;

    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache entry
      }
    }

    return null;
  }

  /**
   * Cache rendered content
   */
  private async cacheRender(
    templateId: string,
    data: any,
    locale: string | undefined,
    content: RenderedContent,
    ttl?: number
  ): Promise<void> {
    const cacheKey = this.getCacheKey(templateId, data, locale);
    const cacheTTL = ttl || this.options?.cacheTTL || 3600;

    if (this.redis) {
      await this.redis.setex(cacheKey, cacheTTL, JSON.stringify(content));
    }
  }

  /**
   * Generate cache key
   */
  private getCacheKey(templateId: string, data: any, locale?: string): string {
    const dataHash = hash(data);
    return `${this.cacheKeyPrefix}${templateId}:${dataHash}:${locale || 'default'}`;
  }

  /**
   * Validate template structure
   */
  private validateTemplate(template: NotificationTemplate): void {
    if (!template.id) {
      throw new Error('Template ID is required');
    }

    if (!template.name) {
      throw new Error('Template name is required');
    }

    if (!template.channels || template.channels.length === 0) {
      throw new Error('At least one channel is required');
    }

    if (!template.content || Object.keys(template.content).length === 0) {
      throw new Error('Template content is required');
    }
  }

  /**
   * Get all registered templates
   */
  async getAllTemplates(): Promise<NotificationTemplate[]> {
    return Array.from(this.templates.values());
  }

  /**
   * Delete a template
   */
  async deleteTemplate(templateId: string): Promise<boolean> {
    const deleted = this.templates.delete(templateId);

    if (deleted) {
      if (this.redis) {
        await this.redis.del(`notifications:template:${templateId}`);
      }
    }

    return deleted;
  }

  /**
   * Get a template by ID
   */
  getTemplate(templateId: string): NotificationTemplate | undefined {
    return this.templates.get(templateId);
  }

  /**
   * List all templates
   */
  listTemplates(): NotificationTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Remove a template (alias for deleteTemplate)
   */
  async removeTemplate(templateId: string): Promise<boolean> {
    return this.deleteTemplate(templateId);
  }

  /**
   * Render template for a specific channel
   */
  async renderForChannel(
    templateId: string,
    channel: string,
    data: any,
    options: RenderOptions = {}
  ): Promise<RenderedContent> {
    const template = this.getTemplate(templateId);
    if (!template) {
      return {};
    }

    const channelContent = template.content[channel as keyof typeof template.content];
    if (!channelContent) {
      return {};
    }

    const rendered: RenderedContent = {};
    const replaceVars = (text: string): string => {
      return this.replaceVariables(text, data);
    };

    if ('subject' in channelContent) {
      rendered.subject = replaceVars(channelContent.subject);
    }
    if ('html' in channelContent) {
      rendered.html = replaceVars(channelContent.html);
    }
    if ('text' in channelContent) {
      rendered.text = replaceVars(channelContent.text || '');
    }
    if ('message' in channelContent) {
      rendered.text = replaceVars(channelContent.message);
    }
    if ('title' in channelContent) {
      rendered.subject = replaceVars(channelContent.title);
    }
    if ('body' in channelContent) {
      rendered.text = replaceVars(channelContent.body);
    }

    return rendered;
  }

  /**
   * Process a notification with optional template
   */
  async processNotification(notification: any): Promise<any> {
    if (notification.templateId) {
      const template = this.getTemplate(notification.templateId);
      if (template) {
        const data = { ...notification, ...notification.data };
        const rendered = await this.render(notification.templateId, data);
        return {
          ...notification,
          subject: rendered.subject || notification.title,
          html: rendered.html,
          text: rendered.text || notification.body
        };
      }
    }

    // No template, return original notification with mapped fields
    return {
      ...notification,
      subject: notification.title,
      text: notification.body
    };
  }

  /**
   * Extract variables from template content
   */
  extractVariables(content: string | any): string[] {
    if (typeof content !== 'string') {
      // If content is a template object, extract from all string fields
      const allContent = JSON.stringify(content);
      return this.extractVariables(allContent);
    }

    const regex = /\{\{([^}]+)\}\}/g;
    const variables = new Set<string>();
    let match;

    while ((match = regex.exec(content)) !== null) {
      variables.add(match[1].trim());
    }

    return Array.from(variables);
  }

  /**
   * Replace variables in content
   */
  replaceVariables(content: string, data: any): string {
    let result = content;

    // Simple replacement for all {{variable}} patterns
    const regex = /\{\{([^}]+)\}\}/g;

    result = content.replace(regex, (match, variable) => {
      const trimmed = variable.trim();
      const value = this.getNestedValue(data, trimmed);

      if (value === null || value === undefined) {
        return match; // Keep original placeholder if value not found
      }

      return String(value);
    });

    return result;
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }

    return current;
  }
}