/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const srcDir = path.join(__dirname, '..', 'src');
const distDir = path.join(__dirname, '..', 'dist');

// Function to copy files
function copyFiles(src, dest) {
  if (!fs.existsSync(dest)) {
    console.log(`Creating directory: ${dest}`);
    fs.mkdirSync(dest, { recursive: true });
  }

  fs.readdirSync(src).forEach((file) => {
    const srcFile = path.join(src, file);
    const destFile = path.join(dest, file);

    if (fs.lstatSync(srcFile).isDirectory()) {
      console.log(`Copying directory: ${srcFile} to ${destFile}`);
      copyFiles(srcFile, destFile);
    } else if (path.extname(file) !== '.ts') {
      console.log(`Copying file: ${srcFile} to ${destFile}`);
      fs.copyFileSync(srcFile, destFile);
    }
  });
}

// Function to clean directory
function cleanDirectory(dir) {
  if (fs.existsSync(dir)) {
    console.log(`Cleaning directory: ${dir}`);
    fs.readdirSync(dir).forEach((file) => {
      const filePath = path.join(dir, file);
      if (fs.lstatSync(filePath).isDirectory()) {
        cleanDirectory(filePath);
        console.log(`Removing directory: ${filePath}`);
        fs.rmdirSync(filePath);
      } else {
        console.log(`Removing file: ${filePath}`);
        fs.unlinkSync(filePath);
      }
    });
  }
}

// Clean the dist directory before copying files
console.log('Starting to clean the dist directory');
cleanDirectory(distDir);
console.log('Finished cleaning the dist directory');

// Copy all files
console.log('Starting to copy files');
copyFiles(srcDir, distDir);
console.log('Finished copying files');

// Compile ts files
console.log('Starting TypeScript file compilation');
exec(
  `${path.join(__dirname, '..', '..', '..', 'node_modules/.bin/tsc')} --build ./tsconfig.build.json`,
  (err, stdout, stderr) => {
    if (err) {
      console.error('Compilation error:');
      console.error(stdout);
      console.error(`Error message: ${stderr}`);
      console.error(err);
      process.exit(1);
    }
    console.log('Compilation completed successfully');
    console.log(stdout);
  }
);
