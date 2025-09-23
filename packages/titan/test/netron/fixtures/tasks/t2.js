exports.failingTask = async function failingTask() {
  throw new Error('Intentional task failure');
}