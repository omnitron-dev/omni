'use strict';

Object.defineProperty(exports, '__esModule', { value: true });
exports.failingTask = failingTask;
async function failingTask() {
  throw new Error('Intentional task failure');
}
