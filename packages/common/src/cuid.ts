import { sha3_512 as sha3 } from '@noble/hashes/sha3';

const defaultLength = 24;
const bigLength = 32;

const createEntropy = (length = 4, random = Math.random) => {
  let entropy = '';

  while (entropy.length < length) {
    entropy = entropy + Math.floor(random() * 36).toString(36);
  }
  return entropy;
};

/*
 * Adapted from https://github.com/juanelas/bigint-conversion
 * MIT License Copyright (c) 2018 Juan Hernández Serrano
 */
export function bufToBigInt(buf: Uint8Array<ArrayBufferLike>) {
  const bits = BigInt(8);

  let value = BigInt(0);
  for (const i of buf.values()) {
    const bi = BigInt(i);

    value = (value << bits) + bi;
  }
  return value;
}

const hash = (input = '') =>
  // Отбрасываем первый символ, чтобы не было смещения гистограммы влево.
  bufToBigInt(sha3(new TextEncoder().encode(input)))
    .toString(36)
    .slice(1);

const alphabet = Array.from({ length: 26 }, (_, i) => String.fromCharCode(i + 97));

const randomLetter = (random: () => number) => alphabet[Math.floor(random() * alphabet.length)];

/*
This is a fingerprint of the host environment. It is used to help
prevent collisions when generating ids in a distributed system.
If no global object is available, you can pass in your own, or fall back
on a random string.
*/
export const createFingerprint = ({
  globalObj = typeof global !== 'undefined' ? global : typeof window !== 'undefined' ? window : {},
  random = Math.random,
} = {}) => {
  const globals = Object.keys(globalObj).toString();
  const sourceString = globals.length ? globals + createEntropy(bigLength, random) : createEntropy(bigLength, random);

  return hash(sourceString).substring(0, bigLength);
};

export const createCounter = (count: number) => () => count++;

// ~22k hosts before 50% chance of initial counter collision
// with a remaining counter range of 9.0e+15 in JavaScript.
const initialCountMax = 476782367;

export const init = ({
  // Fallback if the user does not pass in a CSPRNG. This should be OK
  // because we don't rely solely on the random number generator for entropy.
  // We also use the host fingerprint, current time, and a session counter.
  random = Math.random,
  counter = createCounter(Math.floor(random() * initialCountMax)),
  length = defaultLength,
  fingerprint = createFingerprint({ random }),
} = {}) =>
  function cuid2() {
    const firstLetter = randomLetter(random);

    // If we're lucky, the `.toString(36)` calls may reduce hashing rounds
    // by shortening the input to the hash function a little.
    const time = Date.now().toString(36);
    const count = counter().toString(36);

    // The salt should be long enough to be globally unique across the full
    // length of the hash. For simplicity, we use the same length as the
    // intended id output.
    const salt = createEntropy(length, random);
    const hashInput = `${time + salt + count + fingerprint}`;

    return `${firstLetter + hash(hashInput).substring(1, length)}`;
  };

export const cuid = init({
  length: 16,
});

export const isCuid = (id: string, { minLength = 2, maxLength = bigLength } = {}) => {
  const length = id.length;
  const regex = /^[a-z][0-9a-z]+$/;

  try {
    if (typeof id === 'string' && length >= minLength && length <= maxLength && regex.test(id)) return true;
  } finally {
    // do nothing
  }

  return false;
};

export const getConstants = () => ({ defaultLength, bigLength });
