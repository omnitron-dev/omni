import { guardEntry } from './entry-guard.js';

await guardEntry('execution-owner', () => import('./execution-main.js'));
