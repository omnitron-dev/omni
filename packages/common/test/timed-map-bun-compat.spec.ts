import { TimedMap } from '../src/timed-map';

// Bun-compatible version of TimedMap tests
// This file contains tests that work with real timers for Bun compatibility

describe('TimedMap (Bun-compatible)', () => {
  describe('real timer tests', () => {
    it('should delete value after timeout', async () => {
      const map = new TimedMap(50); // Short timeout for tests
      map.set('key1', 100);
      await new Promise(resolve => setTimeout(resolve, 60));
      expect(map.get('key1')).toBeUndefined();
    });

    it('should use custom timeout', async () => {
      const map = new TimedMap(50);
      map.set('key1', 100, undefined, 100);
      await new Promise(resolve => setTimeout(resolve, 60));
      expect(map.get('key1')).toBe(100);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(map.get('key1')).toBeUndefined();
    });

    it('should call custom callback after timeout', async () => {
      const map = new TimedMap(50);
      let callbackCalled = false;
      let callbackKey: unknown;
      
      const callback = (key: unknown) => {
        callbackCalled = true;
        callbackKey = key;
      };
      
      map.set('key1', 100, callback);
      await new Promise(resolve => setTimeout(resolve, 60));
      
      expect(callbackCalled).toBe(true);
      expect(callbackKey).toBe('key1');
    });

    it('should reset timer when setting value again', async () => {
      const map = new TimedMap(50);
      map.set('key1', 100);
      await new Promise(resolve => setTimeout(resolve, 25));
      map.set('key1', 200);
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(map.get('key1')).toBe(200);
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(map.get('key1')).toBeUndefined();
    });

    it('should cancel timer when deleting', async () => {
      const map = new TimedMap(50);
      let callbackCalled = false;
      
      const callback = () => {
        callbackCalled = true;
      };
      
      map.set('key1', 100, callback);
      map.delete('key1');
      await new Promise(resolve => setTimeout(resolve, 60));
      
      expect(callbackCalled).toBe(false);
    });

    it('should cancel all timers on clear', async () => {
      const map = new TimedMap(50);
      let callback1Called = false;
      let callback2Called = false;
      
      const callback1 = () => {
        callback1Called = true;
      };
      
      const callback2 = () => {
        callback2Called = true;
      };
      
      map.set('key1', 100, callback1);
      map.set('key2', 200, callback2);
      map.clear();
      await new Promise(resolve => setTimeout(resolve, 60));
      
      expect(callback1Called).toBe(false);
      expect(callback2Called).toBe(false);
    });
  });
});