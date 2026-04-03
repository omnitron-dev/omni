const short = require('short-uuid');
const { nanoid } = require('nanoid');
const Benchmark = require('benchmark');
const { v4: uuidv4 } = require('uuid');
const { randomUUID } = require('crypto');
const { cuid } = require('@bugsnag/cuid');
const uuidRandom = require('uuid-random');
const { v4: uuidv4Secure } = require('uuid-with-v6');

const suite = new Benchmark.Suite();

// Add tests
suite
  .add('crypto.randomUUID', () => {
    randomUUID();
  })
  .add('uuid@11.1.0', () => {
    uuidv4();
  })
  .add('@bugsnag/cuid', () => {
    cuid();
  })
  .add('nanoid', () => {
    nanoid();
  })
  .add('uuid-random', () => {
    uuidRandom();
  })
  .add('uuid-with-v6', () => {
    uuidv4Secure();
  })
  .add('short-uuid', () => {
    short.generate();
  })
  .on('cycle', (event) => {
    console.log(String(event.target));
  })
  .run({ async: true });
