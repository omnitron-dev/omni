import { describe, expect, it } from 'vitest';
import { frameworkRepositoryMetadata, isFrameworkRef, parseFrameworkSource } from '../../src/shared/framework-source.js';

describe('generic framework source configuration', () => {
  it.each(['https://git.example.test/team/framework.git', 'ssh://git@git.example.test/team/framework',
    'git@git.example.test:team/framework.git', '/opt/sources/framework', '../framework', 'file:///opt/sources/framework'])
  ('preserves the selected repository without inventing a provider or branch: %s', repository => {
    const result = parseFrameworkSource({ repository });
    expect(result).toEqual({ repository }); expect(Object.isFrozen(result)).toBe(true);
  });
  it.each(['refs/heads/main', 'refs/heads/release/stable', 'refs/tags/v1.2.3'])('preserves explicit ref: %s', ref => {
    expect(parseFrameworkSource({ repository: '../framework', ref })).toEqual({ repository: '../framework', ref });
  });
  it.each(['main', 'v1.2.3', 'HEAD', 'refs/pull/1/head', 'refs/heads/x..y', 'refs/tags/x.lock',
    'refs/heads/.x', 'refs/heads/x/', 'refs/heads/x@{y', 'refs/heads/x^', 'refs/heads/x?', 'refs/heads/x\\y'])
  ('refuses ambiguous or malformed ref: %s', ref => {
    expect(isFrameworkRef(ref)).toBe(false);
    expect(() => parseFrameworkSource({ repository: '../framework', ref })).toThrow('Framework ref');
  });
  it.each([null, [], {}, { repository: '(no origin)' }, { repository: '../framework', ref: 1 },
    { repository: '../framework', branch: 'main' }, { repository: '../framework', ref: null }])
  ('refuses malformed explicit configuration without fallback', value => {
    expect(() => parseFrameworkSource(value)).toThrow();
  });
  it('does not expose credentials in validation errors', () => {
    try { parseFrameworkSource({ repository: 'https://secret-token@git.example.test/framework' }); }
    catch (error) { expect(String(error)).not.toContain('secret-token'); return; }
    throw Error('Unsafe repository was accepted');
  });
  it('reads conventional package repository metadata and distinguishes absence from invalid metadata', () => {
    expect(frameworkRepositoryMetadata(undefined)).toBeUndefined();
    expect(frameworkRepositoryMetadata({ type: 'git', url: 'git+https://git.example.test/team/framework.git', directory: 'packages/core' }))
      .toBe('git+https://git.example.test/team/framework.git');
    expect(() => frameworkRepositoryMetadata({ url: 'https://secret-token@git.example.test/framework' })).toThrow();
    expect(() => frameworkRepositoryMetadata({})).toThrow();
  });
});
