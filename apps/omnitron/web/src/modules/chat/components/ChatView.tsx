import { defineComponent, onMount } from '@omnitron-dev/aether';
import { inject } from '@omnitron-dev/aether/di';
import { Show, For } from '@omnitron-dev/aether/control-flow';
import { ChatService } from '../services/chat.service';
import { MessageService } from '../services/message.service';
import { useChatStore } from '../stores/chat.store';

/**
 * AI Chat View
 *
 * Main chat interface container
 */
export default defineComponent(() => {
  const chatService = inject(ChatService);
  const messageService = inject(MessageService);
  const chatStore = useChatStore();

  onMount(() => {
    // Create initial conversation if none exists
    if (chatService.getConversations().length === 0) {
      const conversation = chatService.createConversation('New Chat');
      chatService.addMessage(conversation.id, {
        role: 'assistant',
        content: `👋 Hello! I'm your AI assistant for Omnitron.

I can help you with:
• Writing and debugging code
• Creating flows and automations
• Explaining concepts and documentation
• Optimizing performance
• Architecture decisions

How can I assist you today?`,
      });
    }
  });

  const sendMessage = async () => {
    const message = chatStore.inputMessage().trim();
    if (!message) return;

    const conversation = chatService.getActiveConversation();
    if (!conversation) return;

    chatStore.setTyping(true);
    chatStore.clearInput();

    try {
      await messageService.sendMessage(conversation.id, message);
    } finally {
      chatStore.setTyping(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    const conversation = chatService.getActiveConversation();
    if (!conversation) return;

    if (confirm('Clear all messages in this conversation?')) {
      chatService.clearMessages(conversation.id);
      chatService.addMessage(conversation.id, {
        role: 'assistant',
        content: 'Chat cleared. How can I help you?',
      });
    }
  };

  return () => {
    const conversation = chatService.getActiveConversation();
    const messages = conversation ? chatService.getMessages(conversation.id) : [];

    return (
      <div class="view chat-view">
        <div class="view-header">
          <h2>AI Chat</h2>
          <div class="chat-actions">
            <select
              class="model-selector"
              value={chatStore.selectedModel()}
              onChange={(e) => chatStore.setModel(e.currentTarget.value)}
            >
              <option value="gpt-4">GPT-4</option>
              <option value="gpt-3.5">GPT-3.5 Turbo</option>
              <option value="claude">Claude 3</option>
              <option value="llama">Llama 2</option>
            </select>
            <button class="tool-button" onClick={clearChat}>
              Clear
            </button>
            <button class="tool-button">Export</button>
          </div>
        </div>

        <div class="view-content">
          <div class="chat-container">
            <div class="messages-container">
              <For each={() => messages}>
                {(message) => (
                  <div class={`message message-${message().role}`}>
                    <div class="message-header">
                      <span class="message-role">{message().role === 'user' ? '👤 You' : '🤖 Assistant'}</span>
                      <span class="message-time">{message().timestamp.toLocaleTimeString()}</span>
                    </div>
                    <div class="message-content">
                      <pre>{message().content}</pre>
                    </div>
                  </div>
                )}
              </For>
              <Show when={chatStore.isTyping}>
                <div class="message message-assistant typing">
                  <div class="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </Show>
            </div>

            <div class="chat-input-container">
              <div class="chat-input-wrapper">
                <textarea
                  class="chat-input"
                  value={chatStore.inputMessage()}
                  onInput={(e) => chatStore.setInputMessage(e.currentTarget.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask me anything..."
                  rows={3}
                />
                <div class="chat-input-actions">
                  <button class="tool-button" title="Attach file">
                    📎
                  </button>
                  <button class="tool-button" title="Code block">
                    {'</>'}
                  </button>
                  <button class="tool-button" title="Settings">
                    ⚙️
                  </button>
                  <button class="send-button" onClick={sendMessage} disabled={() => !chatStore.canSend()}>
                    {chatStore.isTyping() ? '⏳' : '📤'} Send
                  </button>
                </div>
              </div>
              <div class="chat-hints">
                <span>Press Enter to send, Shift+Enter for new line</span>
                <span>Model: {chatStore.selectedModel()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };
});
