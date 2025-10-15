import { defineComponent, signal, onMount } from '@omnitron-dev/aether';
import { Show, For } from '@omnitron-dev/aether/control-flow';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

/**
 * AI Chat View
 *
 * AI-powered chat interface for assistance and code generation
 */
export default defineComponent(() => {
  const messages = signal<Message[]>([]);
  const inputMessage = signal('');
  const isTyping = signal(false);
  const selectedModel = signal('gpt-4');

  onMount(() => {
    // Add welcome message
    messages.set([{
      id: '1',
      role: 'assistant',
      content: `👋 Hello! I'm your AI assistant for Omnitron.

I can help you with:
• Writing and debugging code
• Creating flows and automations
• Explaining concepts and documentation
• Optimizing performance
• Architecture decisions

How can I assist you today?`,
      timestamp: new Date()
    }]);
  });

  const sendMessage = async () => {
    const message = inputMessage().trim();
    if (!message) return;

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date()
    };

    messages.update(msgs => [...msgs, userMessage]);
    inputMessage.set('');
    isTyping.set(true);

    // Simulate AI response
    setTimeout(() => {
      const responses = [
        "I understand you're working with flows. Let me help you create an efficient data pipeline.",
        "Here's a code snippet that might help:\n\n```typescript\nconst processData = async (input: any) => {\n  // Processing logic here\n  return transformed;\n}\n```",
        "Based on your requirements, I recommend using a reactive pattern with Aether signals for optimal performance.",
        "That's an interesting approach! Have you considered using the built-in module system for better organization?",
        "I can help you optimize that. The key is to leverage Aether's fine-grained reactivity system.",
      ];

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responses[Math.floor(Math.random() * responses.length)],
        timestamp: new Date()
      };

      messages.update(msgs => [...msgs, assistantMessage]);
      isTyping.set(false);
    }, 1500);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    messages.set([{
      id: Date.now().toString(),
      role: 'assistant',
      content: 'Chat cleared. How can I help you?',
      timestamp: new Date()
    }]);
  };

  return () => (
    <div class="view chat-view">
      <div class="view-header">
        <h2>AI Chat</h2>
        <div class="chat-actions">
          <select
            class="model-selector"
            value={selectedModel()}
            onChange={(e) => selectedModel.set(e.currentTarget.value)}
          >
            <option value="gpt-4">GPT-4</option>
            <option value="gpt-3.5">GPT-3.5 Turbo</option>
            <option value="claude">Claude 3</option>
            <option value="llama">Llama 2</option>
          </select>
          <button class="tool-button" onClick={clearChat}>Clear</button>
          <button class="tool-button">Export</button>
        </div>
      </div>

      <div class="view-content">
        <div class="chat-container">
          <div class="messages-container">
            <For each={messages}>
              {(message) => (
                <div class={`message message-${message().role}`}>
                  <div class="message-header">
                    <span class="message-role">
                      {message().role === 'user' ? '👤 You' : '🤖 Assistant'}
                    </span>
                    <span class="message-time">
                      {message().timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <div class="message-content">
                    <pre>{message().content}</pre>
                  </div>
                </div>
              )}
            </For>
            <Show when={isTyping}>
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
                value={inputMessage()}
                onInput={(e) => inputMessage.set(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me anything..."
                rows={3}
              />
              <div class="chat-input-actions">
                <button class="tool-button" title="Attach file">📎</button>
                <button class="tool-button" title="Code block">{'</>'}</button>
                <button class="tool-button" title="Settings">⚙️</button>
                <button
                  class="send-button"
                  onClick={sendMessage}
                  disabled={() => !inputMessage().trim() || isTyping()}
                >
                  {isTyping() ? '⏳' : '📤'} Send
                </button>
              </div>
            </div>
            <div class="chat-hints">
              <span>Press Enter to send, Shift+Enter for new line</span>
              <span>Model: {selectedModel()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});