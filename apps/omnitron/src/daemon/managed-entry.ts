import { guardEntry } from './entry-guard.js';

await guardEntry('runtime-launcher', () => import('./managed-main.js'));
