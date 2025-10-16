#!/usr/bin/env node

// Simple build script for aether-devtools extension
// Currently just validates the extension structure

const fs = require('fs');
const path = require('path');

console.log('Building Aether DevTools extension...');

// Check required files
const requiredFiles = ['manifest.json', 'devtools.html', 'panel.html'];

const packageDir = path.resolve(__dirname, '..');
let success = true;

for (const file of requiredFiles) {
  const filePath = path.join(packageDir, file);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing required file: ${file}`);
    success = false;
  }
}

if (success) {
  console.log('✓ Extension structure validated');
  console.log('✓ Build complete');
} else {
  console.error('✗ Build failed: missing required files');
  process.exit(1);
}
