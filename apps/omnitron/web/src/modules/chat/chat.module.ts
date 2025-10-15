import { defineModule } from '@omnitron-dev/aether/di';
import { ChatService } from './services/chat.service';
import { MessageService } from './services/message.service';
import { AIService } from './services/ai.service';
import { ContextService } from './services/context.service';

/**
 * Chat Module
 *
 * AI assistant chat interface module
 */
export const ChatModule = defineModule({
  id: 'chat',
  version: '1.0.0',

  providers: [ChatService, MessageService, AIService, ContextService],

  stores: [() => import('./stores/chat.store')],

  routes: [
    {
      path: '/chat',
      component: () => import('./components/ChatView'),
      meta: { title: 'AI Chat - Omnitron' },
    },
  ],

  exportProviders: [ChatService],

  exportStores: ['chat'],

  metadata: {
    name: 'Chat Module',
    description: 'AI assistant chat interface',
    author: 'Omnitron Team',
  },

  optimization: {
    lazyBoundary: true,
    splitChunk: true,
  },
});
