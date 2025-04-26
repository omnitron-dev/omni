import fs from 'fs';
import path from 'path';

// 🔥 Function for recursive directory traversal with flexible includes/excludes
function walkDir(
  baseDir: string,
  currentDir: string,
  includePaths: string[],
  excludePaths: string[]
): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(currentDir);

  list.forEach((file) => {
    const filePath = path.join(currentDir, file);
    const stat = fs.statSync(filePath);
    const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');

    const isIncluded =
      includePaths.length === 0 ||
      includePaths.some((incPath) => relativePath.startsWith(incPath));

    const isExcluded = excludePaths.some((excPath) => (
      relativePath === excPath ||
      relativePath.startsWith(excPath + '/')
    ));

    if (isExcluded) {
      return; // skip explicitly excluded path
    }

    if (stat.isDirectory()) {
      results = results.concat(walkDir(baseDir, filePath, includePaths, excludePaths));
    } else if (isIncluded) {
      results.push(filePath);
    }
  });

  return results;
}

// 🔥 Generate ChatGPT-compatible prompt
function generatePrompt(
  projectPath: string,
  includePaths: string[] = [],
  excludePaths: string[] = []
): string {
  const defaultExcludeDirs = ['dist', 'node_modules', 'coverage', '.turbo'];

  const allExcludePaths = [...defaultExcludeDirs, ...excludePaths].map((p) =>
    p.replace(/\\/g, '/')
  );
  const normalizedIncludePaths = includePaths.map((p) => p.replace(/\\/g, '/'));

  const files = walkDir(
    projectPath,
    projectPath,
    normalizedIncludePaths,
    allExcludePaths
  );

  let prompt = '';

  files.forEach((file) => {
    const relativePath = path.relative(projectPath, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf8');

    prompt += `### File: ${relativePath}\n`;
    prompt += '```\n';
    prompt += content;
    prompt += '\n```\n\n';
  });

  return prompt;
}

function savePromptToFile(
  projectPath: string,
  includePaths: string[] = [],
  excludePaths: string[] = []
) {
  const outputFile = path.join(projectPath, 'prompt.txt');
  const prompt = generatePrompt(projectPath, includePaths, excludePaths);
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
  --include    Comma-separated list of directories/files to include (can be nested paths)
  --exclude    Comma-separated list of directories/files to exclude (can be nested paths)

Example:
  node generate-prompt.js /path/to/project
  node generate-prompt.js /path/to/project --include=src,lib/subdir
  node generate-prompt.js /path/to/project --exclude=node_modules,dist
  node generate-prompt.js /path/to/project --include=src/subdir --exclude=node_modules
  `);
}

// Parse command line arguments
const args = process.argv.slice(2);
const projectPath = args[0];

if (!projectPath) {
  printUsage();
  process.exit(1);
}

if (!fs.existsSync(projectPath)) {
  console.error('❌ Project directory not found');
  process.exit(1);
}

// Parse include and exclude options
const includeOption = args.find((arg) => arg.startsWith('--include='));
const excludeOption = args.find((arg) => arg.startsWith('--exclude='));

const includePaths = includeOption ? includeOption.split('=')[1]?.split(',') : [];
const excludePaths = excludeOption ? excludeOption.split('=')[1]?.split(',') : [];

// Run the script
savePromptToFile(projectPath, includePaths, excludePaths);
