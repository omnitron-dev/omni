export class MemoryFileStore {
  values = new Map<string, unknown>();
  fail = false;
  kvGetSync<T>(key: string): T | null {
    return structuredClone(this.values.get(key) ?? null) as T | null;
  }
  kvSetSync<T>(key: string, value: T) {
    if (this.fail) throw new Error('journal unavailable');
    this.values.set(key, structuredClone(value));
  }
  kvDeleteSync(key: string) {
    this.values.delete(key);
  }
}
