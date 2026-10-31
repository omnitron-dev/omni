import { guardEntry } from './entry-guard.js';

await guardEntry('daemon', () => import('./daemon-main.js'));
