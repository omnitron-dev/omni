import { guardEntry } from './entry-guard.js';

await guardEntry('backend-supervisor', () => import('./backend-supervisor-main.js'));
