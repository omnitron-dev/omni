/**
 * NB-2: the client core-task name constants must equal the server's BARE task
 * names. The server's TaskManager registers tasks by `fn.name` and routes an
 * incoming runTask via an exact `tasks.get(name)` — so a `netron.`-prefixed
 * client constant never matched (dead/broken). Pin the bare values here.
 */

import { describe, it, expect } from 'vitest';
import { CORE_TASK_AUTHENTICATE } from '../../src/core-tasks/authenticate.js';
import { CORE_TASK_INVALIDATE_CACHE } from '../../src/core-tasks/invalidate-cache.js';

describe('NB-2: core-task name constants', () => {
  it('CORE_TASK_AUTHENTICATE is the bare server task name', () => {
    expect(CORE_TASK_AUTHENTICATE).toBe('authenticate');
    expect(CORE_TASK_AUTHENTICATE).not.toMatch(/^netron\./);
  });

  it('CORE_TASK_INVALIDATE_CACHE is the bare server task name', () => {
    expect(CORE_TASK_INVALIDATE_CACHE).toBe('invalidate_cache');
    expect(CORE_TASK_INVALIDATE_CACHE).not.toMatch(/^netron\./);
  });
});
