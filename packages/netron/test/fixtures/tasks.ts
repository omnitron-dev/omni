export async function asyncTask(a: number, b: number) {
  return a + b;
}

export async function failingTask() {
  throw new Error('Intentional task failure');
}

export function syncTask(a: number, b: number) {
  return a * b;
}

export async function delayedTask(ms: number) {
  return new Promise((resolve) => setTimeout(() => resolve('done'), ms));
}

export function throwingTask() {
  throw new Error('Intentional sync failure');
}
