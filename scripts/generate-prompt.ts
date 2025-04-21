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
function walkDir(dir: string, excludeDirs: string[] = []): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);

  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (!excludeDirs.includes(file)) {
        results = results.concat(walkDir(filePath, excludeDirs));
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
function generatePrompt(projectPath: string, isProjectMode: boolean = false): string {
  const baseDir = isProjectMode ? projectPath : path.join(projectPath, 'src');
  const excludeDirs = ['dist', 'node_modules', 'coverage'];
  const excludeFiles = ['LICENSE', '.npmrc', 'package-lock.json'];

  const files = walkDir(baseDir, [...excludeDirs, ...excludeFiles]);
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

function savePromptToFile(projectPath: string, isProjectMode: boolean = false) {
  const outputFile = path.join(projectPath, 'prompt.txt');
  const prompt = generatePrompt(projectPath, isProjectMode);
  fs.writeFileSync(outputFile, prompt);
  console.log(`✅ Prompt saved to ${outputFile}`);
}

function printUsage() {
  console.log(`
Usage:
  node generate-prompt.js [--project] <project-path>

Description:
  Generates a ChatGPT prompt based on the project source code.
  Saves the result to prompt.txt in the project root.

Options:
  --project    Process all project files excluding dist, node_modules, etc.

Example:
  node generate-prompt.js /path/to/your/project
  node generate-prompt.js --project /path/to/your/project
  `);
}

// Parse command line arguments
const args = process.argv.slice(2);
const isProjectMode = args.includes('--project');
const projectPath = isProjectMode ? args[args.indexOf('--project') + 1] : args[0];

if (!projectPath) {
  printUsage();
  process.exit(1);
}

// Check if directory exists
if (!fs.existsSync(projectPath)) {
  console.error('❌ Project directory not found');
  process.exit(1);
}

// Run the script
savePromptToFile(projectPath, isProjectMode);
