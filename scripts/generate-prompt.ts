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
function walkDir(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      results = results.concat(walkDir(filePath));
    } else {
      results.push(filePath);
    }
  });
  return results;
}

// 🔥 Generate ChatGPT-compatible prompt
function generatePrompt(projectPath: string): string {
  const srcDir = path.join(projectPath, 'src');
  const files = walkDir(srcDir);
  let prompt = `Here are the project files and their contents:\n\n`;

  files.forEach((file) => {
    const relativePath = path.relative(srcDir, file);
    const content = fs.readFileSync(file, 'utf8');

    prompt += `### File: ${relativePath}\n`;
    prompt += '```\n';
    prompt += content;
    prompt += '\n```\n\n';
  });

  return prompt;
}

function savePromptToFile(projectPath: string) {
  const outputFile = path.join(projectPath, 'prompt.txt');
  const prompt = generatePrompt(projectPath);
  fs.writeFileSync(outputFile, prompt);
  console.log(`✅ Prompt saved to ${outputFile}`);
}

function printUsage() {
  console.log(`
Usage:
  node generate-prompt.js <project-path>

Description:
  Generates a ChatGPT prompt based on the project source code.
  Saves the result to prompt.txt in the project root.

Example:
  node generate-prompt.js /path/to/your/project
  `);
}

// Get project path from command line arguments
const projectPath = process.argv[2];
if (!projectPath) {
  printUsage();
  process.exit(1);
}

// Check if src directory exists
const srcDir = path.join(projectPath, 'src');
if (!fs.existsSync(srcDir)) {
  console.error('❌ src directory not found in the project');
  process.exit(1);
}

// Run the script
savePromptToFile(projectPath);
