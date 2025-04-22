import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

export function copyToClipboard(text: string) {
  const platform = os.platform();
  try {
    if (platform === 'linux') {
      execSync(`echo "${text}" | xclip -selection clipboard`);
    } else if (platform === 'darwin') {
      execSync(`echo "${text}" | pbcopy`);
    } else if (platform === 'win32') {
      execSync(`echo "${text}" | clip`);
    }
  } catch (error) {
    console.error('❌ Error copying to clipboard:', error);
  }
}

// 🔥 Function for recursive traversal of directory
function walkDir(dir: string, includeDirs: string[] = [], excludeDirs: string[] = []): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);

  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (includeDirs.length === 0 || includeDirs.includes(file)) {
        if (!excludeDirs.includes(file)) {
          results = results.concat(walkDir(filePath, includeDirs, excludeDirs));
        }
      }
    } else {
      if (!excludeDirs.includes(file)) {
        results.push(filePath);
      }
    }
  });

  return results;
}

// 🔥 Generate ChatGPT-compatible prompt
function generatePrompt(projectPath: string, includeDirs: string[] = [], excludeDirs: string[] = []): string {
  const baseDir = projectPath;
  const defaultExcludeDirs = ['dist', 'node_modules', 'coverage'];

  const files = walkDir(baseDir, includeDirs, [...defaultExcludeDirs, ...excludeDirs]);
  let prompt = `Here are the project files and their contents:\n\n`;

  files.forEach((file) => {
    const relativePath = path.relative(baseDir, file);
    const content = fs.readFileSync(file, 'utf8');

    prompt += `### File: ${relativePath}\n`;
    prompt += '```\n';
    prompt += content;
    prompt += '\n```\n\n';
  });

  return prompt;
}

function savePromptToFile(projectPath: string, includeDirs: string[] = [], excludeDirs: string[] = []) {
  const outputFile = path.join(projectPath, 'prompt.txt');
  const prompt = generatePrompt(projectPath, includeDirs, excludeDirs);
  fs.writeFileSync(outputFile, prompt);
  console.log(`✅ Prompt saved to ${outputFile}`);
}

function printUsage() {
  console.log(`
Usage:
  node generate-prompt.js <project-path> [--include=<dir1,dir2>] [--exclude=<dir1,dir2>]

Description:
  Generates a ChatGPT prompt based on the project source code.
  Saves the result to prompt.txt in the project root.

Options:
  --include    Comma-separated list of directories to include (if not specified, all directories are included)
  --exclude    Comma-separated list of directories to exclude

Example:
  node generate-prompt.js /path/to/your/project
  node generate-prompt.js /path/to/your/project --include=src,lib
  node generate-prompt.js /path/to/your/project --exclude=node_modules,dist
  node generate-prompt.js /path/to/your/project --include=src --exclude=node_modules
  `);
}

// Parse command line arguments
const args = process.argv.slice(2);
const projectPath = args[0];

if (!projectPath) {
  printUsage();
  process.exit(1);
}

// Check if directory exists
if (!fs.existsSync(projectPath)) {
  console.error('❌ Project directory not found');
  process.exit(1);
}

// Parse include and exclude options
const includeOption = args.find(arg => arg.startsWith('--include='));
const excludeOption = args.find(arg => arg.startsWith('--exclude='));

const includeDirs = includeOption ? includeOption.split('=')[1]?.split(',') : [];
const excludeDirs = excludeOption ? excludeOption.split('=')[1]?.split(',') : [];

// Run the script
savePromptToFile(projectPath, includeDirs, excludeDirs);
