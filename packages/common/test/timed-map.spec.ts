import { TimedMap } from '../src/timed-map';

describe('TimedMap', () => {
  let map: TimedMap<string, number>;

  beforeEach(() => {
    jest.useFakeTimers();
    map = new TimedMap(1000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create instance with default values', () => {
      const defaultMap = new TimedMap();
      expect(defaultMap.timeout).toBe(1000);
    });

    it('should create instance with specified timeout', () => {
      const customMap = new TimedMap(2000);
      expect(customMap.timeout).toBe(2000);
    });
  });

  describe('set and get', () => {
    it('should store and return value', () => {
      map.set('key1', 100);
      expect(map.get('key1')).toBe(100);
    });

    it('should overwrite existing value', () => {
      map.set('key1', 100);
      map.set('key1', 200);
      expect(map.get('key1')).toBe(200);
    });

    it('should delete value after timeout', () => {
      map.set('key1', 100);
      jest.advanceTimersByTime(1000);
      expect(map.get('key1')).toBeUndefined();
    });

    it('should use custom timeout', () => {
      map.set('key1', 100, undefined, 2000);
      jest.advanceTimersByTime(1000);
      expect(map.get('key1')).toBe(100);
      jest.advanceTimersByTime(1000);
      expect(map.get('key1')).toBeUndefined();
    });

    it('should call custom callback after timeout', () => {
      const callback = jest.fn();
      map.set('key1', 100, callback);
      jest.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledWith('key1');
    });

    it('should reset timer when setting value again', () => {
      map.set('key1', 100);
      jest.advanceTimersByTime(500);
      map.set('key1', 200);
      jest.advanceTimersByTime(500);
      expect(map.get('key1')).toBe(200);
      jest.advanceTimersByTime(500);
      expect(map.get('key1')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should delete value and return true', () => {
      map.set('key1', 100);
      expect(map.delete('key1')).toBe(true);
      expect(map.get('key1')).toBeUndefined();
    });

    it('should return false when deleting non-existent key', () => {
      expect(map.delete('nonexistent')).toBe(false);
    });

    it('should cancel timer when deleting', () => {
      const callback = jest.fn();
      map.set('key1', 100, callback);
      map.delete('key1');
      jest.advanceTimersByTime(1000);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should delete all values', () => {
      map.set('key1', 100);
      map.set('key2', 200);
      map.clear();
      expect(map.get('key1')).toBeUndefined();
      expect(map.get('key2')).toBeUndefined();
    });

    it('should cancel all timers', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      map.set('key1', 100, callback1);
      map.set('key2', 200, callback2);
      map.clear();
      jest.advanceTimersByTime(1000);
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });
  });

  describe('forEach', () => {
    it('should execute callback for each element', () => {
      const callback = jest.fn();
      map.set('key1', 100);
      map.set('key2', 200);
      map.forEach(callback, null);
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith(100, 'key1', map);
      expect(callback).toHaveBeenCalledWith(200, 'key2', map);
    });

    it('should use correct this context', () => {
      const context = { test: true };
      const callback = jest.fn(function (this: any) {
        expect(this).toBe(context);
      });
      map.set('key1', 100);
      map.forEach(callback, context);
    });
  });

  describe('entries', () => {
    it('should return iterator of [key, value] pairs', () => {
      map.set('key1', 100);
      map.set('key2', 200);
      const entries = Array.from(map.entries());
      expect(entries).toEqual([
        ['key1', 100],
        ['key2', 200]
      ]);
    });
  });

  describe('values', () => {
    it('should return iterator of values', () => {
      map.set('key1', 100);
      map.set('key2', 200);
      const values = Array.from(map.values());
      expect(values).toEqual([100, 200]);
    });
  });

  describe('integration tests', () => {
    it('should work correctly with multiple operations', () => {
      // Setting values
      map.set('key1', 100);
      map.set('key2', 200);
      expect(map.get('key1')).toBe(100);
      expect(map.get('key2')).toBe(200);

      // Partial time advancement
      jest.advanceTimersByTime(500);
      map.set('key3', 300);

      // Updating existing value
      map.set('key1', 150);

      // Check after half timeout
      expect(map.get('key1')).toBe(150);
      expect(map.get('key2')).toBe(200);
      expect(map.get('key3')).toBe(300);

      // Advance time to full timeout
      jest.advanceTimersByTime(500);
      expect(map.get('key2')).toBeUndefined();
      expect(map.get('key1')).toBe(150);
      expect(map.get('key3')).toBe(300);

      // Final time advancement
      jest.advanceTimersByTime(500);
      expect(map.get('key1')).toBeUndefined();
      expect(map.get('key3')).toBeUndefined();

      jest.advanceTimersByTime(500);
      expect(map.get('key3')).toBeUndefined();
    });
  });
});
