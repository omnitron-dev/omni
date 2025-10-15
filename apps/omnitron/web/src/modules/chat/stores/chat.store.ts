/**
 * Chat Store
 *
 * Reactive state for chat module
 */

import { defineStore, signal, computed, readonly } from '@omnitron-dev/aether/store';

/**
 * Chat Store
 *
 * Manages chat UI state including typing status, model selection, and input.
 *
 * @example
 * ```typescript
 * const chatStore = useChatStore();
 *
 * // Set input message
 * chatStore.setInputMessage('Hello!');
 *
 * // Toggle sidebar
 * chatStore.toggleSidebar();
 *
 * // Set typing state
 * chatStore.setTyping(true);
 * ```
 */
export const useChatStore = defineStore('chat', () => {
  // UI state
  const isTyping = signal(false);
  const selectedModel = signal('gpt-4');
  const isSidebarOpen = signal(true);

  // Input state
  const inputMessage = signal('');
  const attachedFiles = signal<File[]>([]);

  // Settings
  const temperature = signal(0.7);
  const maxTokens = signal(2000);
  const autoSave = signal(true);

  // Computed values
  const hasInput = computed(() => inputMessage().trim().length > 0);
  const hasAttachments = computed(() => attachedFiles().length > 0);
  const canSend = computed(() => hasInput() && !isTyping());

  const state = computed(() => ({
    isTyping: isTyping(),
    selectedModel: selectedModel(),
    isSidebarOpen: isSidebarOpen(),
    inputMessage: inputMessage(),
    attachedFiles: attachedFiles(),
    temperature: temperature(),
    maxTokens: maxTokens(),
    autoSave: autoSave(),
  }));

  // Actions

  /**
   * Set typing state
   */
  const setTyping = (typing: boolean) => {
    isTyping.set(typing);
  };

  /**
   * Set selected model
   */
  const setModel = (model: string) => {
    selectedModel.set(model);
  };

  /**
   * Toggle sidebar
   */
  const toggleSidebar = () => {
    isSidebarOpen.set(!isSidebarOpen());
  };

  /**
   * Set input message
   */
  const setInputMessage = (message: string) => {
    inputMessage.set(message);
  };

  /**
   * Clear input
   */
  const clearInput = () => {
    inputMessage.set('');
    attachedFiles.set([]);
  };

  /**
   * Add attached file
   */
  const addAttachment = (file: File) => {
    attachedFiles.set([...attachedFiles(), file]);
  };

  /**
   * Remove attached file
   */
  const removeAttachment = (index: number) => {
    attachedFiles.set(attachedFiles().filter((_, i) => i !== index));
  };

  /**
   * Set temperature
   */
  const setTemperature = (temp: number) => {
    temperature.set(Math.max(0, Math.min(1, temp)));
  };

  /**
   * Set max tokens
   */
  const setMaxTokens = (tokens: number) => {
    maxTokens.set(Math.max(1, tokens));
  };

  /**
   * Set auto save
   */
  const setAutoSave = (value: boolean) => {
    autoSave.set(value);
  };

  /**
   * Reset store
   */
  const reset = () => {
    isTyping.set(false);
    selectedModel.set('gpt-4');
    isSidebarOpen.set(true);
    inputMessage.set('');
    attachedFiles.set([]);
    temperature.set(0.7);
    maxTokens.set(2000);
    autoSave.set(true);
  };

  return {
    // State (readonly)
    isTyping: readonly(isTyping),
    selectedModel: readonly(selectedModel),
    isSidebarOpen: readonly(isSidebarOpen),
    inputMessage: readonly(inputMessage),
    attachedFiles: readonly(attachedFiles),
    temperature: readonly(temperature),
    maxTokens: readonly(maxTokens),
    autoSave: readonly(autoSave),

    // Computed
    hasInput,
    hasAttachments,
    canSend,
    state,

    // Actions
    setTyping,
    setModel,
    toggleSidebar,
    setInputMessage,
    clearInput,
    addAttachment,
    removeAttachment,
    setTemperature,
    setMaxTokens,
    setAutoSave,
    reset,
  };
});
