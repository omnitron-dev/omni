/**
 * Canvas Module
 *
 * Module definition for the Canvas feature.
 * Provides flow programming visual canvas functionality.
 */

import { defineModule } from '@omnitron-dev/aether/di';
import { FlowService } from './services/flow.service';
import { CanvasService } from './services/canvas.service';

/**
 * Canvas Module Definition
 *
 * Provides visual flow programming capabilities with:
 * - Flow creation and management
 * - Visual node-based programming
 * - Canvas rendering and interaction
 * - Flow persistence
 */
export const CanvasModule = defineModule({
  id: 'canvas',
  version: '1.0.0',

  providers: [FlowService, CanvasService],

  stores: [() => import('./stores/canvas.store')],

  routes: [
    {
      path: '/',
      component: () => import('./components/CanvasView'),
      meta: { title: 'Flow Canvas - Omnitron' },
    },
    {
      path: '/canvas',
      component: () => import('./components/CanvasView'),
      meta: { title: 'Flow Canvas - Omnitron' },
    },
  ],

  exportProviders: [FlowService],

  exportStores: ['canvas'],

  metadata: {
    name: 'Canvas Module',
    description: 'Visual flow programming canvas',
    author: 'Omnitron Team',
  },

  optimization: {
    lazyBoundary: true,
    splitChunk: true,
  },
});

// Export services for direct use
export { FlowService, CanvasService };

// Export components
export { FlowCanvas } from './components/FlowCanvas';
export { FlowNode } from './components/FlowNode';
export { FlowConnection } from './components/FlowConnection';

// Export stores
export { useCanvasStore } from './stores/canvas.store';

// Export types
export type { CanvasTransform, CanvasSelection } from './services/canvas.service';
