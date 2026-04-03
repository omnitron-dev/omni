export async function delayedTask(ms) {
  return new Promise((resolve) => setTimeout(() => resolve('done'), ms));
}
