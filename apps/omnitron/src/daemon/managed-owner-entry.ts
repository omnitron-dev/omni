import { guardEntry } from './entry-guard.js';

await guardEntry('execution-owner', () => import('./managed-owner-main.js'));
