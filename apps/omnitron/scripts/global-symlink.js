/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const targetPath = path.resolve(__dirname, '../bin/omnitron');
let symlinkPath = '/usr/local/bin/omnitron';

const args = process.argv.slice(2);

// Check for the presence of the --name option and set the symlink name
const nameIndex = args.indexOf('--name');
if (nameIndex !== -1 && args[nameIndex + 1]) {
  symlinkPath = path.join('/usr/local/bin', args[nameIndex + 1]);
}

try {
  if (args.includes('--del')) {
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
      console.log(`Symlink successfully deleted: ${symlinkPath}`);
    } else {
      console.log(`Symlink does not exist: ${symlinkPath}`);
    }
  } else {
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
    }
    fs.symlinkSync(targetPath, symlinkPath, 'file');
    console.log(`Symlink successfully created: ${symlinkPath} -> ${targetPath}`);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
}
