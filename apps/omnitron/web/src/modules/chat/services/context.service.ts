import { Injectable } from '@omnitron-dev/aether/di';
import type { Message } from './chat.service';

export interface ConversationContext {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

/**
 * Context Service
 *
 * Manages conversation context and AI parameters
 */
@Injectable({ scope: 'module' })
export class ContextService {
  private defaultContext: ConversationContext = {
    systemPrompt: `You are a helpful AI assistant for Omnitron, a meta-system for fractal computing.
You can help users with:
- Writing and debugging code
- Creating flows and automations
- Explaining concepts and documentation
- Optimizing performance
- Architecture decisions

Be concise, helpful, and technical when appropriate.`,
    temperature: 0.7,
    maxTokens: 2000,
    topP: 1,
  };

  /**
   * Get context for a conversation
   */
  getContext(conversationId?: string): ConversationContext {
    // In a real implementation, this would retrieve stored context
    return { ...this.defaultContext };
  }

  /**
   * Update context for a conversation
   */
  updateContext(conversationId: string, context: Partial<ConversationContext>) {
    // In a real implementation, this would store the updated context
    console.log('Updating context for conversation', conversationId, context);
  }

  /**
   * Build prompt with context
   */
  buildPrompt(messages: Message[], context?: ConversationContext): string {
    const ctx = context || this.defaultContext;
    const systemMessage = ctx.systemPrompt || '';

    const messageTexts = messages.map(m => `${m.role}: ${m.content}`).join('\n');

    return `${systemMessage}\n\n${messageTexts}`;
  }

  /**
   * Extract relevant context from messages
   */
  extractContext(messages: Message[]): Record<string, any> {
    // Analyze messages for context clues
    const context: Record<string, any> = {
      messageCount: messages.length,
      hasCode: messages.some(m => m.content.includes('```')),
      topics: this.extractTopics(messages),
    };

    return context;
  }

  /**
   * Extract topics from messages
   */
  private extractTopics(messages: Message[]): string[] {
    const topics = new Set<string>();
    const keywords = [
      'flow',
      'module',
      'terminal',
      'editor',
      'chat',
      'settings',
      'code',
      'debug',
      'optimize',
      'architecture',
    ];

    messages.forEach(message => {
      const content = message.content.toLowerCase();
      keywords.forEach(keyword => {
        if (content.includes(keyword)) {
          topics.add(keyword);
        }
      });
    });

    return Array.from(topics);
  }

  /**
   * Reset context to defaults
   */
  resetContext(conversationId: string) {
    this.updateContext(conversationId, this.defaultContext);
  }
}
