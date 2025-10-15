import { Injectable } from '@omnitron-dev/aether/di';
import type { Message } from './chat.service';

/**
 * AI Service
 *
 * Handles AI backend communication
 */
@Injectable({ scope: 'module' })
export class AIService {
  private model = 'gpt-4';

  /**
   * Set AI model
   */
  setModel(model: string) {
    this.model = model;
  }

  /**
   * Get current model
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Generate AI response
   */
  async generateResponse(messages: Message[]): Promise<string> {
    // Simulate AI response delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Simulated responses for demo
    const responses = [
      "I understand you're working with flows. Let me help you create an efficient data pipeline.",
      "Here's a code snippet that might help:\n\n```typescript\nconst processData = async (input: any) => {\n  // Processing logic here\n  return transformed;\n}\n```",
      "Based on your requirements, I recommend using a reactive pattern with Aether signals for optimal performance.",
      "That's an interesting approach! Have you considered using the built-in module system for better organization?",
      "I can help you optimize that. The key is to leverage Aether's fine-grained reactivity system.",
      "Let me break that down for you:\n\n1. First, define your data structure\n2. Then, create the processing pipeline\n3. Finally, handle edge cases and errors",
      "Great question! In Omnitron, you can achieve this by combining the Terminal and Flow Canvas modules.",
      "The best practice here is to use dependency injection for better testability and maintainability.",
    ];

    // Return a random response for demo purposes
    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * Generate streaming response
   */
  async *generateStreamingResponse(
    messages: Message[]
  ): AsyncGenerator<string, void, unknown> {
    const response = await this.generateResponse(messages);
    const words = response.split(' ');

    for (const word of words) {
      yield word + ' ';
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /**
   * Check if AI service is available
   */
  async isAvailable(): Promise<boolean> {
    // In a real implementation, this would check the backend
    return true;
  }

  /**
   * Get available models
   */
  getAvailableModels(): Array<{ id: string; name: string }> {
    return [
      { id: 'gpt-4', name: 'GPT-4' },
      { id: 'gpt-3.5', name: 'GPT-3.5 Turbo' },
      { id: 'claude', name: 'Claude 3' },
      { id: 'llama', name: 'Llama 2' },
    ];
  }
}
