// Mock for uuid package in ESM mode
let counter = 0;

export function v4(): string {
  counter++;
  return `mock-uuid-${counter}-${Date.now().toString(36)}`;
}

export function v1(): string {
  counter++;
  return `mock-uuid-v1-${counter}-${Date.now().toString(36)}`;
}

export function validate(uuid: string): boolean {
  return typeof uuid === 'string' && uuid.length > 0;
}

export function version(uuid: string): number | null {
  if (uuid.startsWith('mock-uuid-v1')) return 1;
  if (uuid.startsWith('mock-uuid-')) return 4;
  return null;
}

export default { v4, v1, validate, version };
