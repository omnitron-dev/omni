import { connect } from 'node:net';

import { describeError } from '../src/errors.js';

describe('describeError', () => {
  describe('the reported failure: AggregateError with an empty message', () => {
    it('describes a real ECONNREFUSED AggregateError from node:net', async () => {
      // This is the exact shape that made the daemon log {"error":""}: on
      // Node 22+ a connection attempt to an unreachable host rejects with a
      // native AggregateError whose own `message` is '' — every ECONNREFUSED
      // lives in `errors[]`.
      const error = await new Promise<Error>((resolve, reject) => {
        const socket = connect({ host: 'localhost', port: 1 });
        socket.on('error', (err) => {
          socket.destroy();
          resolve(err);
        });
        socket.on('connect', () => {
          socket.destroy();
          reject(new Error('expected localhost:1 to refuse the connection'));
        });
      });

      // Guard the premise: if this ever stops being empty, the helper is still
      // correct but this test no longer covers the case it was written for.
      expect(error.message).toBe('');

      const described = describeError(error);
      expect(described).not.toBe('');
      expect(described).toContain('ECONNREFUSED');
    });

    it('falls back to the constructor name and unwraps members', () => {
      const aggregate = new AggregateError([
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }),
        Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' }),
      ]);
      Object.assign(aggregate, { code: 'ECONNREFUSED' });

      expect(aggregate.message).toBe('');
      expect(describeError(aggregate)).toBe(
        'AggregateError (ECONNREFUSED): [connect ECONNREFUSED 127.0.0.1:5432; connect ECONNREFUSED ::1:5432]'
      );
    });

    it('keeps an aggregate message when it has one', () => {
      const aggregate = new AggregateError([new Error('first'), new Error('second')], 'all pools failed');
      expect(describeError(aggregate)).toBe('all pools failed: [first; second]');
    });

    it('renders an aggregate with no members as its message alone', () => {
      expect(describeError(new AggregateError([], 'nothing to do'))).toBe('nothing to do');
    });

    it('caps the number of rendered members', () => {
      const members = Array.from({ length: 13 }, (_, i) => new Error(`e${i}`));
      const described = describeError(new AggregateError(members, 'many'), { maxErrors: 3 });
      expect(described).toBe('many: [e0; e1; e2; (+10 more)]');
    });

    it('unwraps an iterable `errors` from a cross-realm aggregate', () => {
      const crossRealm = {
        name: 'AggregateError',
        message: '',
        errors: new Set([new Error('left'), new Error('right')]),
      };
      expect(describeError(crossRealm)).toBe('AggregateError: [left; right]');
    });
  });

  describe('cause chains', () => {
    it('appends a single cause', () => {
      const error = new Error('write failed', { cause: new Error('disk full') });
      expect(describeError(error)).toBe('write failed <- caused by: disk full');
    });

    it('follows a nested cause chain', () => {
      const root = new Error('ENOSPC');
      const middle = new Error('flush failed', { cause: root });
      const top = new Error('checkpoint aborted', { cause: middle });
      expect(describeError(top)).toBe('checkpoint aborted <- caused by: flush failed <- caused by: ENOSPC');
    });

    it('stops at maxDepth instead of walking forever', () => {
      let error = new Error('root');
      for (let i = 0; i < 10; i++) {
        error = new Error(`level-${i}`, { cause: error });
      }
      const described = describeError(error, { maxDepth: 2 });
      expect(described).toBe('level-9 <- caused by: level-8 <- caused by: level-7 <- caused by: …');
    });

    it('renders a non-Error cause', () => {
      expect(describeError(new Error('rejected', { cause: 'upstream said no' }))).toBe(
        'rejected <- caused by: upstream said no'
      );
    });

    it('does not loop on a circular cause', () => {
      const a = new Error('a');
      const b = new Error('b', { cause: a });
      Object.assign(a, { cause: b });
      expect(describeError(a)).toBe('a <- caused by: b <- caused by: [circular]');
    });

    it('does not loop when an aggregate contains itself', () => {
      const aggregate = new AggregateError([], 'self');
      aggregate.errors.push(aggregate);
      expect(describeError(aggregate)).toBe('self: [[circular]]');
    });

    it('combines aggregate members and a cause', () => {
      const aggregate = new AggregateError([new Error('a'), new Error('b')], 'pool exhausted', {
        cause: new Error('config invalid'),
      });
      expect(describeError(aggregate)).toBe('pool exhausted: [a; b] <- caused by: config invalid');
    });
  });

  describe('the `code` suffix', () => {
    it('appends a Node system error code', () => {
      const error = Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' });
      expect(describeError(error)).toBe('lookup failed (ENOTFOUND)');
    });

    it('does not repeat a code already present in the message', () => {
      const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' });
      expect(describeError(error)).toBe('connect ECONNREFUSED 127.0.0.1:6379');
    });

    it('accepts a numeric code', () => {
      const error = Object.assign(new Error('exited'), { code: 137 });
      expect(describeError(error)).toBe('exited (137)');
    });

    it('ignores a non-scalar code', () => {
      const error = Object.assign(new Error('odd'), { code: { nested: true } });
      expect(describeError(error)).toBe('odd');
    });
  });

  describe('non-Error values', () => {
    it('describes primitives', () => {
      expect(describeError('boom')).toBe('boom');
      expect(describeError(42)).toBe('42');
      expect(describeError(true)).toBe('true');
      expect(describeError(null)).toBe('null');
      expect(describeError(undefined)).toBe('undefined');
    });

    it('never returns an empty string for an empty throw', () => {
      expect(describeError('')).toBe('<empty string>');
      expect(describeError('   ')).toBe('<empty string>');
    });

    it('serialises plain objects', () => {
      expect(describeError({ status: 503, detail: 'upstream' })).toBe('{"status":503,"detail":"upstream"}');
    });

    it('falls back for an empty or circular object', () => {
      expect(describeError({})).toBe('[object object]');

      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      expect(describeError(circular)).toBe('[object object]');
    });

    it('describes a symbol without throwing', () => {
      expect(describeError(Symbol('nope'))).toBe('Symbol(nope)');
    });
  });

  describe('hostile inputs', () => {
    it('survives a throwing message getter', () => {
      const hostile = {
        name: 'HostileError',
        get message(): string {
          throw new Error('nope');
        },
      };
      // Duck-typing reads `message` through the same guarded accessor, so the
      // value is not error-like and falls through to the object renderer.
      expect(describeError(hostile)).not.toBe('');
    });

    it('survives an error whose cause getter throws', () => {
      const error = new Error('outer');
      Object.defineProperty(error, 'cause', {
        get() {
          throw new Error('cause exploded');
        },
      });
      expect(describeError(error)).toBe('outer');
    });

    it('describes a cross-realm error without instanceof', () => {
      const crossRealm = { name: 'TypeError', message: 'x is not a function' };
      expect(describeError(crossRealm)).toBe('x is not a function');
    });

    it('uses the name when a cross-realm error has an empty message', () => {
      expect(describeError({ name: 'WorkerError', message: '' })).toBe('WorkerError');
    });
  });
});
