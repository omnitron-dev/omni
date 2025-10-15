import { Injectable, inject } from '@omnitron-dev/aether/di';
import { ChatService } from './chat.service';
import { AIService } from './ai.service';

/**
 * Message Service
 *
 * Handles message sending and receiving
 */
@Injectable({ scope: 'module' })
export class MessageService {
  private chatService = inject(ChatService);
  private aiService = inject(AIService);

  /**
   * Send a user message and get AI response
   */
  async sendMessage(conversationId: string, content: string): Promise<void> {
    // Add user message
    this.chatService.addMessage(conversationId, {
      role: 'user',
      content,
    });

    // Get AI response
    const response = await this.aiService.generateResponse(
      this.chatService.getMessages(conversationId)
    );

    // Add assistant message
    this.chatService.addMessage(conversationId, {
      role: 'assistant',
      content: response,
    });
  }

  /**
   * Format message content
   */
  formatMessage(content: string): string {
    // Add any formatting logic here (markdown, code blocks, etc.)
    return content;
  }

  /**
   * Extract code blocks from message
   */
  extractCodeBlocks(content: string): Array<{ language: string; code: string }> {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const blocks: Array<{ language: string; code: string }> = [];

    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      blocks.push({
        language: match[1] || 'text',
        code: match[2].trim(),
      });
    }

    return blocks;
  }
}
