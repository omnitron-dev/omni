import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

const SRC_DIR = path.resolve(__dirname, 'src');
const TESTS_DIR = path.resolve(__dirname, 'tests');

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

// 🔥 Function for recursive traversal of `src/`
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
function generatePrompt(): string {
  const files = walkDir(SRC_DIR);
  // const files = walkDir(TESTS_DIR);
  let prompt = `Here are the project files and their contents:\n\n`;

  files.forEach((file) => {
    const relativePath = path.relative(SRC_DIR, file);
    const content = fs.readFileSync(file, 'utf8');

    prompt += `### File: ${relativePath}\n`;
    prompt += '```\n';
    prompt += content;
    prompt += '\n```\n\n';
  });

  return prompt;
}

const OUTPUT_FILE = path.resolve(__dirname, 'prompt.txt');

function savePromptToFile() {
  const prompt = generatePrompt();
  fs.writeFileSync(OUTPUT_FILE, prompt);
  console.log(`✅ Prompt saved to ${OUTPUT_FILE}`);
}

// Run the script
savePromptToFile();
