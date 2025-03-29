'use strict';

Object.defineProperty(exports, '__esModule', { value: true });
exports.delayedTask = delayedTask;
async function delayedTask(ms) {
  return new Promise((resolve) => setTimeout(() => resolve('done'), ms));
}
