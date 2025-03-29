// A function that does nothing
export const noop = () => { };

// A function that returns the same value that is passed to it
export const identity = <T>(x: T): T => x;

// A function that always returns true
export const truly = (): boolean => true;

// A function that always returns false
export const falsely = (): boolean => false;

// A function that converts a value to an array
// If the value is null or undefined, it returns an empty array
// If the value is already an array, it returns the value as is
// Otherwise, it returns an array containing the value
export const arrify = <T>(val: T | T[] | undefined | null): T[] => {
  if (val === null || val === undefined) {
    return [];
  }
  return Array.isArray(val) ? val : [val];
};
