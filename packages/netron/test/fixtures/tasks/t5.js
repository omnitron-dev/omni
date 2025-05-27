'use strict';

Object.defineProperty(exports, '__esModule', { value: true });
exports.throwingTask = throwingTask;
function throwingTask() {
  throw new Error('Intentional sync failure');
}
