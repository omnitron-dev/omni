import { defineModule } from '@omnitron-dev/aether/di';
import { SettingsService } from './services/settings.service';
import { PreferencesService } from './services/preferences.service';
import { ConfigService } from './services/config.service';

/**
 * Settings Module
 *
 * Application settings and configuration module
 */
export const SettingsModule = defineModule({
  id: 'settings',
  version: '1.0.0',

  providers: [SettingsService, PreferencesService, ConfigService],

  stores: [() => import('./stores/settings.store')],

  routes: [
    {
      path: '/settings',
      component: () => import('./components/SettingsView'),
      meta: { title: 'Settings - Omnitron' },
    },
  ],

  exportProviders: [SettingsService],

  exportStores: ['settings'],

  metadata: {
    name: 'Settings Module',
    description: 'Application settings and configuration',
    author: 'Omnitron Team',
  },

  optimization: {
    lazyBoundary: true,
    splitChunk: true,
  },
});
