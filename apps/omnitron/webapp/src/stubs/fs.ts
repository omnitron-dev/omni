// Stub for node:fs / fs / fs/promises
// Prism's registry/installer uses these but they're server-only code.
// This stub prevents Vite from erroring on the import in browser context.

const notAvailable = () => {
  throw new Error('fs is not available in browser');
};

export const readFile = notAvailable;
export const writeFile = notAvailable;
export const mkdir = notAvailable;
export const readdir = notAvailable;
export const stat = notAvailable;
export const access = notAvailable;
export const copyFile = notAvailable;
export const rm = notAvailable;

export const promises = {
  readFile,
  writeFile,
  mkdir,
  readdir,
  stat,
  access,
  copyFile,
  rm,
};

export default { promises, readFile, writeFile, mkdir, readdir, stat, access, copyFile, rm };
