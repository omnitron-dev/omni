import { Injectable } from '@omnitron-dev/aether/di';
import { signal } from '@omnitron-dev/aether';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface Conversation {
  id: string;
  name: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Chat Service
 *
 * Manages chat state and conversations
 */
@Injectable({ scope: 'module' })
export class ChatService {
  private conversations = signal<Conversation[]>([]);
  private activeConversationId = signal<string | null>(null);

  /**
   * Get all conversations
   */
  getConversations(): Conversation[] {
    return this.conversations();
  }

  /**
   * Get active conversation
   */
  getActiveConversation(): Conversation | undefined {
    return this.conversations().find(c => c.id === this.activeConversationId());
  }

  /**
   * Create a new conversation
   */
  createConversation(name?: string): Conversation {
    const conversation: Conversation = {
      id: Date.now().toString(),
      name: name || `Chat ${this.conversations().length + 1}`,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.conversations.update(convs => [...convs, conversation]);
    this.setActiveConversation(conversation.id);

    return conversation;
  }

  /**
   * Set active conversation
   */
  setActiveConversation(conversationId: string) {
    this.activeConversationId.set(conversationId);
  }

  /**
   * Delete a conversation
   */
  deleteConversation(conversationId: string) {
    this.conversations.update(convs =>
      convs.filter(c => c.id !== conversationId)
    );

    if (this.activeConversationId() === conversationId) {
      const remaining = this.conversations();
      if (remaining.length > 0) {
        this.setActiveConversation(remaining[0].id);
      } else {
        this.activeConversationId.set(null);
      }
    }
  }

  /**
   * Add message to conversation
   */
  addMessage(conversationId: string, message: Omit<Message, 'id' | 'timestamp'>) {
    const newMessage: Message = {
      ...message,
      id: Date.now().toString(),
      timestamp: new Date(),
    };

    this.conversations.update(convs =>
      convs.map(c =>
        c.id === conversationId
          ? {
              ...c,
              messages: [...c.messages, newMessage],
              updatedAt: new Date(),
            }
          : c
      )
    );

    return newMessage;
  }

  /**
   * Get messages for a conversation
   */
  getMessages(conversationId: string): Message[] {
    const conversation = this.conversations().find(c => c.id === conversationId);
    return conversation?.messages || [];
  }

  /**
   * Clear all messages in a conversation
   */
  clearMessages(conversationId: string) {
    this.conversations.update(convs =>
      convs.map(c =>
        c.id === conversationId
          ? { ...c, messages: [], updatedAt: new Date() }
          : c
      )
    );
  }

  /**
   * Update conversation name
   */
  updateConversationName(conversationId: string, name: string) {
    this.conversations.update(convs =>
      convs.map(c =>
        c.id === conversationId ? { ...c, name, updatedAt: new Date() } : c
      )
    );
  }
}
