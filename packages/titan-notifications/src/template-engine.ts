/**
 * Notifications Template Engine
 *
 * Simple, efficient template rendering for notifications.
 * Supports multi-channel templates and variable substitution.
 *
 * @module
 */

import { Injectable } from '@omnitron-dev/titan/decorators';
import type { NotificationPayload } from './notifications.types.js';
import { ChannelType } from './channel/channel.interface.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Notification template definition with multi-channel support
 */
export interface NotificationTemplate {
  /** Unique template identifier */
  id: string;
  /** Human-readable template name */
  name: string;
  /** Optional template description */
  description?: string;
  /** Supported delivery channels */
  channels: ChannelType[];
  /** Template content for each channel */
  content: TemplateContent;
  /** Expected variable definitions */
  variables?: TemplateVariable[];
  /** Default locale for this template */
  defaultLocale?: string;
  /** Localized versions of template content */
  locales?: Record<string, TemplateContent>;
  /** Optional category for organization */
  category?: string;
  /** Tags for searching/filtering */
  tags?: string[];
  /** Version number for tracking changes */
  version?: number;
  /** Creation timestamp */
  createdAt?: number;
  /** Last update timestamp */
  updatedAt?: number;
}

/**
 * Template content structure for all channels
 */
export interface TemplateContent {
  /** Email channel content */
  email?: {
    subject: string;
    html?: string;
    text: string;
  };
  /** SMS channel content */
  sms?: {
    text: string;
  };
  /** Push notification content */
  push?: {
    title: string;
    body: string;
  };
  /** In-app notification content */
  inApp?: {
    title: string;
    body: string;
  };
  /** Webhook payload content */
  webhook?: {
    payload: Record<string, unknown>;
  };
}

/**
 * Variable definition for template validation
 */
export interface TemplateVariable {
  /** Variable name (used in {{name}} syntax) */
  name: string;
  /** Expected variable type */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /** Whether this variable is required */
  required?: boolean;
  /** Default value if not provided */
  default?: unknown;
  /** Human-readable description */
  description?: string;
}

/**
 * Rendered template content after variable substitution
 */
export interface RenderedContent {
  /** Email subject (email channel) */
  subject?: string;
  /** HTML content (email channel) */
  html?: string;
  /** Plain text content (email, sms channels) */
  text?: string;
  /** Notification title (push, inApp channels) */
  title?: string;
  /** Notification body (push, inApp channels) */
  body?: string;
  /** Webhook payload (webhook channel) */
  payload?: Record<string, unknown>;
}

/**
 * Options for template rendering
 */
export interface RenderOptions {
  /** Target locale for localized templates */
  locale?: string;
  /** Specific channel to render for */
  channel?: ChannelType;
  /** Skip cache lookup and force fresh render */
  skipCache?: boolean;
}

/**
 * Configuration options for TemplateEngine
 */
export interface TemplateEngineOptions {
  /** Enable Redis caching for rendered templates */
  cacheEnabled?: boolean;
  /** Cache TTL in seconds (default: 3600) */
  cacheTTL?: number;
  /** Redis key prefix (default: 'notifications:template:') */
  keyPrefix?: string;
}

/**
 * Validation result for template data
 */
export interface ValidationResult {
  /** Whether all required variables are present */
  valid: boolean;
  /** List of missing required variables */
  missing: string[];
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Template engine for rendering multi-channel notification templates.
 *
 * Features:
 * - Simple {{variable}} substitution syntax
 * - Nested variable support (e.g., {{user.name}})
 * - Multi-channel template rendering
 * - Optional in-memory caching
 * - Locale support for internationalization
 * - Template validation
 *
 * @example
 * ```typescript
 * const engine = new TemplateEngine({ cacheEnabled: true });
 *
 * // Register a template
 * engine.register({
 *   id: 'welcome',
 *   name: 'Welcome Message',
 *   channels: [ChannelType.Email],
 *   content: {
 *     email: {
 *       subject: 'Welcome {{userName}}!',
 *       text: 'Hello {{userName}}, welcome to {{appName}}.'
 *     }
 *   },
 *   variables: [
 *     { name: 'userName', type: 'string', required: true },
 *     { name: 'appName', type: 'string', default: 'Our App' }
 *   ]
 * });
 *
 * // Render template
 * const rendered = engine.render('welcome', { userName: 'John' });
 * // { subject: 'Welcome John!', text: 'Hello John, welcome to Our App.' }
 * ```
 */
@Injectable()
export class TemplateEngine {
  /**
   * Maximum number of cached rendered templates.
   * Prevents unbounded memory growth from rendering many unique template+data combinations.
   */
  private static readonly MAX_RENDER_CACHE_SIZE = 1000;

  private readonly templates = new Map<string, NotificationTemplate>();
  private readonly cache = new Map<string, { content: RenderedContent; expiresAt: number }>();

  private readonly options: Required<TemplateEngineOptions>;

  constructor(options?: TemplateEngineOptions) {
    this.options = {
      cacheEnabled: options?.cacheEnabled ?? true,
      cacheTTL: options?.cacheTTL ?? 3600,
      keyPrefix: options?.keyPrefix ?? 'notifications:template:',
    };
  }

  // ============================================================================
  // Template Management
  // ============================================================================

  /**
   * Register a notification template.
   *
   * @param template - Template definition to register
   * @throws {Error} If template validation fails
   */
  register(template: NotificationTemplate): void {
    this.validateTemplate(template);
    template.createdAt = template.createdAt ?? Date.now();
    template.updatedAt = Date.now();
    template.version = (template.version ?? 0) + 1;
    this.templates.set(template.id, template);
  }

  /**
   * Get a template by ID.
   *
   * @param templateId - Template identifier
   * @returns Template definition or undefined if not found
   */
  get(templateId: string): NotificationTemplate | undefined {
    return this.templates.get(templateId);
  }

  /**
   * List all registered templates.
   *
   * @returns Array of all templates
   */
  list(): NotificationTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Delete a template by ID.
   *
   * @param templateId - Template identifier to delete
   * @returns True if template was deleted, false if not found
   */
  delete(templateId: string): boolean {
    return this.templates.delete(templateId);
  }

  /**
   * Check if a template exists.
   *
   * @param templateId - Template identifier to check
   * @returns True if template exists
   */
  has(templateId: string): boolean {
    return this.templates.has(templateId);
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  /**
   * Render a template with provided data.
   *
   * @param templateId - Template identifier
   * @param data - Variable data for substitution
   * @param options - Rendering options (locale, channel, caching)
   * @returns Rendered content with variables replaced
   * @throws {Error} If template not found
   */
  render(templateId: string, data: Record<string, unknown>, options?: RenderOptions): RenderedContent {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template '${templateId}' not found`);
    }

    // Check cache
    const cacheKey = this.getCacheKey(templateId, data, options);
    if (!options?.skipCache && this.options.cacheEnabled) {
      const cached = this.getFromCache(cacheKey);
      if (cached) return cached;
    }

    // Get content for locale
    const locale = options?.locale ?? template.defaultLocale ?? 'en';
    const content = template.locales?.[locale] ?? template.content;

    // Render for specific channel or all
    const channel = options?.channel;
    const rendered = channel ? this.renderForChannel(content, channel, data) : this.renderAllChannels(content, data);

    // Cache result
    if (this.options.cacheEnabled) {
      this.setCache(cacheKey, rendered);
    }

    return rendered;
  }

  /**
   * Render template content for a specific channel.
   *
   * @param content - Template content structure
   * @param channel - Target channel type
   * @param data - Variable data for substitution
   * @returns Rendered content for the specified channel
   */
  renderForChannel(content: TemplateContent, channel: ChannelType, data: Record<string, unknown>): RenderedContent {
    const channelContent = content[channel as keyof TemplateContent];
    if (!channelContent) {
      return {};
    }

    const result: RenderedContent = {};

    if (channel === ChannelType.Email && 'subject' in channelContent) {
      result.subject = this.replaceVariables(channelContent.subject, data);
      if (channelContent.html) {
        result.html = this.replaceVariables(channelContent.html, data);
      }
      result.text = this.replaceVariables(channelContent.text, data);
    } else if (channel === ChannelType.SMS && 'text' in channelContent) {
      result.text = this.replaceVariables(channelContent.text, data);
    } else if ((channel === ChannelType.Push || channel === ChannelType.InApp) && 'title' in channelContent) {
      result.title = this.replaceVariables(channelContent.title, data);
      result.body = this.replaceVariables(channelContent.body, data);
    } else if (channel === ChannelType.Webhook && 'payload' in channelContent) {
      result.payload = this.replaceVariablesInObject(channelContent.payload, data);
    }

    return result;
  }

  /**
   * Render template content for all available channels.
   *
   * @param content - Template content structure
   * @param data - Variable data for substitution
   * @returns Merged rendered content from all channels
   */
  private renderAllChannels(content: TemplateContent, data: Record<string, unknown>): RenderedContent {
    const result: RenderedContent = {};

    if (content.email) {
      result.subject = this.replaceVariables(content.email.subject, data);
      if (content.email.html) {
        result.html = this.replaceVariables(content.email.html, data);
      }
      result.text = this.replaceVariables(content.email.text, data);
    }

    if (content.push || content.inApp) {
      const pushContent = content.push ?? content.inApp;
      if (pushContent && 'title' in pushContent) {
        result.title = this.replaceVariables(pushContent.title, data);
        result.body = this.replaceVariables(pushContent.body, data);
      }
    }

    return result;
  }

  /**
   * Apply rendered template to a notification payload.
   *
   * @param templateId - Template identifier
   * @param payload - Notification payload to enhance
   * @param data - Variable data for substitution
   * @param options - Rendering options
   * @returns Enhanced notification payload with rendered content
   */
  applyToPayload(
    templateId: string,
    payload: NotificationPayload,
    data: Record<string, unknown>,
    options?: RenderOptions
  ): NotificationPayload {
    const rendered = this.render(templateId, { ...data, ...payload.data }, options);

    return {
      ...payload,
      title: rendered.title ?? rendered.subject ?? payload.title,
      message: rendered.body ?? rendered.text ?? payload.message,
      data: {
        ...payload.data,
        _rendered: rendered,
      },
    };
  }

  // ============================================================================
  // Variable Substitution
  // ============================================================================

  /**
   * Replace {{variable}} patterns in a string.
   *
   * Supports:
   * - Simple variables: {{userName}}
   * - Nested variables: {{user.name}}
   * - Deep nesting: {{user.profile.displayName}}
   *
   * @param template - String template with {{variable}} placeholders
   * @param data - Data object containing variable values
   * @returns String with variables replaced
   */
  replaceVariables(template: string, data: Record<string, unknown>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const trimmedPath = path.trim();
      const value = this.getNestedValue(data, trimmedPath);
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Replace variables in an object recursively.
   *
   * @param obj - Object with string values containing {{variable}} placeholders
   * @param data - Data object containing variable values
   * @returns New object with variables replaced
   */
  replaceVariablesInObject(obj: Record<string, unknown>, data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.replaceVariables(value, data);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.replaceVariablesInObject(value as Record<string, unknown>, data);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Get nested value from object using dot notation.
   *
   * @param obj - Source object
   * @param path - Dot-separated path (e.g., 'user.name')
   * @returns Value at path or undefined if not found
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((current: unknown, key) => {
      if (current && typeof current === 'object' && key in current) {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  }

  /**
   * Extract variable names from template content.
   *
   * @param template - Template definition
   * @returns Array of unique variable names found in template
   */
  extractVariables(template: NotificationTemplate): string[] {
    const variables = new Set<string>();
    const content = JSON.stringify(template.content);
    const matches = content.matchAll(/\{\{([^}]+)\}\}/g);

    for (const match of matches) {
      if (match[1]) {
        variables.add(match[1].trim());
      }
    }

    return Array.from(variables);
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
   * Validate template structure.
   *
   * @param template - Template to validate
   * @throws {Error} If template structure is invalid
   */
  private validateTemplate(template: NotificationTemplate): void {
    if (!template.id || typeof template.id !== 'string') {
      throw new Error('Template must have a valid id');
    }
    if (!template.name || typeof template.name !== 'string') {
      throw new Error('Template must have a valid name');
    }
    if (!template.channels || !Array.isArray(template.channels) || template.channels.length === 0) {
      throw new Error('Template must have at least one channel');
    }
    if (!template.content || typeof template.content !== 'object') {
      throw new Error('Template must have content');
    }
  }

  /**
   * Validate data against template variable requirements.
   *
   * @param templateId - Template identifier
   * @param data - Data to validate
   * @returns Validation result with missing variables
   */
  validateData(templateId: string, data: Record<string, unknown>): ValidationResult {
    const template = this.templates.get(templateId);
    if (!template) {
      return { valid: false, missing: ['_template_not_found'] };
    }

    const missing: string[] = [];

    for (const variable of template.variables ?? []) {
      if (variable.required && !(variable.name in data)) {
        if (variable.default === undefined) {
          missing.push(variable.name);
        }
      }
    }

    return { valid: missing.length === 0, missing };
  }

  // ============================================================================
  // Caching
  // ============================================================================

  /**
   * Generate cache key for rendered content.
   */
  private getCacheKey(templateId: string, data: Record<string, unknown>, options?: RenderOptions): string {
    const hash = this.hashData(data);
    const locale = options?.locale ?? 'default';
    const channel = options?.channel ?? 'all';
    return `${templateId}:${locale}:${channel}:${hash}`;
  }

  /**
   * Generate simple hash from data object.
   */
  private hashData(data: Record<string, unknown>): string {
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Get content from cache if not expired.
   */
  private getFromCache(key: string): RenderedContent | null {
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.content;
    }
    if (entry) {
      this.cache.delete(key);
    }
    return null;
  }

  /**
   * Store rendered content in cache.
   */
  private setCache(key: string, content: RenderedContent): void {
    this.cache.set(key, {
      content,
      expiresAt: Date.now() + this.options.cacheTTL * 1000,
    });

    // Cleanup old entries if cache is too large
    if (this.cache.size > 1000) {
      this.cleanupCache();
    }
  }

  /**
   * Remove expired entries from cache and enforce size limit.
   * Uses FIFO eviction when cache exceeds MAX_RENDER_CACHE_SIZE.
   */
  private cleanupCache(): void {
    const now = Date.now();

    // First, remove expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }

    // If still over limit after expiration cleanup, apply FIFO eviction
    while (this.cache.size > TemplateEngine.MAX_RENDER_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      } else {
        break;
      }
    }
  }

  /**
   * Clear all cached renders.
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// ============================================================================
// Default Templates
// ============================================================================

/**
 * Default notification templates for common use cases.
 */
export const DEFAULT_TEMPLATES: NotificationTemplate[] = [
  {
    id: 'welcome',
    name: 'Welcome Notification',
    channels: [ChannelType.Email, ChannelType.InApp],
    content: {
      email: {
        subject: 'Welcome to {{appName}}!',
        html: '<h1>Welcome, {{userName}}!</h1><p>Thank you for joining {{appName}}.</p>',
        text: 'Welcome, {{userName}}! Thank you for joining {{appName}}.',
      },
      inApp: {
        title: 'Welcome!',
        body: 'Thank you for joining {{appName}}, {{userName}}!',
      },
    },
    variables: [
      { name: 'userName', type: 'string', required: true },
      { name: 'appName', type: 'string', default: 'Our App' },
    ],
  },
  {
    id: 'password-reset',
    name: 'Password Reset',
    channels: [ChannelType.Email],
    content: {
      email: {
        subject: 'Reset your {{appName}} password',
        html: '<p>Hi {{userName}},</p><p>Click <a href="{{resetLink}}">here</a> to reset your password.</p><p>This link expires in {{expiresIn}}.</p>',
        text: 'Hi {{userName}}, visit {{resetLink}} to reset your password. This link expires in {{expiresIn}}.',
      },
    },
    variables: [
      { name: 'userName', type: 'string', required: true },
      { name: 'resetLink', type: 'string', required: true },
      { name: 'expiresIn', type: 'string', default: '24 hours' },
      { name: 'appName', type: 'string', default: 'Our App' },
    ],
  },
];
